// server.js
import express from "express";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { exec } from "child_process";
import unzipper from "unzipper";
import { promisify } from "util";

const execAsync = promisify(exec);
const app = express();
app.use(express.json({ limit: "500mb" }));

// Serve static files from /public
app.use(express.static(path.join(process.cwd(), "public")));

// health check
app.get("/healthz", (req, res) => res.json({ status: "ok" }));

// helper: safe sanitize projectId (prevent path traversal)
function sanitizeProjectId(id) {
  return String(id || "project").replace(/[^a-zA-Z0-9-_]/g, "_").substring(0, 60);
}

// helper copy directory (recursive)
async function copyDir(src, dest) {
  await fsp.mkdir(dest, { recursive: true });
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyDir(srcPath, destPath);
    else await fsp.copyFile(srcPath, destPath);
  }
}

app.post("/build", async (req, res) => {
  try {
    const { projectId: rawId, zipBase64 } = req.body;
    const projectId = sanitizeProjectId(rawId);
    if (!projectId || !zipBase64) {
      return res.status(400).json({ error: "Missing projectId or zipBase64" });
    }

    const tmpPath = path.join("/tmp", projectId);
    await fsp.rm(tmpPath, { recursive: true, force: true }).catch(()=>{});
    await fsp.mkdir(tmpPath, { recursive: true });

    // write zip
    const zipPath = path.join(tmpPath, "project.zip");
    await fsp.writeFile(zipPath, Buffer.from(zipBase64, "base64"));

    // unzip
    await unzipper.Open.file(zipPath).then(d => d.extract({ path: tmpPath }));

    // run flutter pub get (best-effort)
    console.log(`[${projectId}] Running flutter pub get...`);
    try {
      await execAsync("flutter pub get", { cwd: tmpPath, maxBuffer: 1024 * 1024 * 200 });
    } catch (e) {
      console.warn(`[${projectId}] flutter pub get failed (continuing):`, e.toString());
    }

    // build web
    console.log(`[${projectId}] Building Flutter web...`);
    await execAsync("flutter build web --release", { cwd: tmpPath, maxBuffer: 1024 * 1024 * 400 });

    const buildPath = path.join(tmpPath, "build", "web");
    const publicPreviewPath = path.join(process.cwd(), "public", "preview", projectId);

    // ensure build exists
    if (!fs.existsSync(buildPath)) {
      throw new Error("build/web not found — build likely failed");
    }

    // copy to public/preview/<projectId>
    await copyDir(buildPath, publicPreviewPath);

    // cleanup temp
    await fsp.rm(tmpPath, { recursive: true, force: true }).catch(()=>{});

    const previewUrl = `/preview/${projectId}/index.html`;
    console.log(`[${projectId}] Build finished. Preview at ${previewUrl}`);

    return res.json({
      success: true,
      message: "Flutter Web build completed!",
      previewUrl
    });
  } catch (err) {
    console.error("Build error:", err);
    return res.status(500).json({ error: String(err) });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Flutter Builder running on port ${PORT}`));
