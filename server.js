import express from "express";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import unzipper from "unzipper";
import { promisify } from "util";

const execAsync = promisify(exec);
const app = express();
app.use(express.json({ limit: "500mb" }));

app.post("/build", async (req, res) => {
  try {
    const { projectId, zipBase64 } = req.body;
    if (!projectId || !zipBase64) return res.status(400).json({ error: "Missing data" });

    const tmpPath = `/tmp/${projectId}`;
    fs.mkdirSync(tmpPath, { recursive: true });

    const zipPath = path.join(tmpPath, "project.zip");
    fs.writeFileSync(zipPath, Buffer.from(zipBase64, "base64"));
    await unzipper.Open.file(zipPath).then(d => d.extract({ path: tmpPath }));

    console.log("Running flutter pub get...");
    await execAsync("flutter pub get", { cwd: tmpPath });

    console.log("Building Flutter web...");
    await execAsync("flutter build web --release", { cwd: tmpPath });

    const buildPath = path.join(tmpPath, "build", "web");
    res.json({
      success: true,
      message: "Flutter Web build completed!",
      previewPath: buildPath
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.toString() });
  }
});

app.listen(8080, () => console.log("🚀 Flutter Builder running on port 8080"));
