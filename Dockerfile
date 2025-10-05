FROM cirrusci/flutter:latest

WORKDIR /app
RUN apt-get update && apt-get install -y unzip curl git nodejs npm
COPY . .
RUN npm install
EXPOSE 8080
CMD ["node", "server.js"]
