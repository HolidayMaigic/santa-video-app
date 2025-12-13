const { GoogleGenAI } = require("@google/genai");
const fs = require("fs");
const path = require("path");

const API_KEY = "AIzaSyDis1BXBxZTNohVApZXfqcapCSmEYGfjhg";

const ai = new GoogleGenAI({ apiKey: API_KEY });

async function pollOperation(operationName, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/${operationName}`;
  
  const response = await fetch(url, {
    headers: {
      "x-goog-api-key": apiKey,
    },
  });
  
  return await response.json();
}

async function downloadVideo(uri, apiKey) {
  const response = await fetch(uri, {
    headers: {
      "x-goog-api-key": apiKey,
    },
  });
  
  return await response.arrayBuffer();
}

async function generateVideo() {
  console.log("Loading Santa image...\n");

  const imagePath = path.join(__dirname, "santa-output.jpg");
  
  if (!fs.existsSync(imagePath)) {
    console.log("❌ santa-output.jpg not found. Run the Santa edit script first!");
    return;
  }

  const imageData = fs.readFileSync(imagePath);
  const base64Image = imageData.toString("base64");

  console.log("Sending to Veo to generate video...\n");
  console.log("(This may take a few minutes)\n");

  try {
    const operation = await ai.models.generateVideos({
      model: "veo-3.1-generate-preview",
      prompt: "Santa Claus gently waves and smiles warmly at the camera, the Christmas tree lights twinkle softly in the background. Subtle, magical movement.",
      image: {
        imageBytes: base64Image,
        mimeType: "image/jpeg",
      },
      config: {
        aspectRatio: "16:9",
        numberOfVideos: 1,
      },
    });

    console.log("✅ Video generation started!");
    console.log("Operation name:", operation.name);
    
    // Poll for completion using raw HTTP
    let attempts = 0;
    const maxAttempts = 60;
    let result;

    while (attempts < maxAttempts) {
      attempts++;
      console.log(`Waiting for video... (attempt ${attempts})`);
      
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      result = await pollOperation(operation.name, API_KEY);
      
      if (result.done) {
        break;
      }
    }

    if (result && result.done) {
      console.log("\n✅ Video generation complete!");
      
      // Navigate the actual response structure
      const generateVideoResponse = result.response?.generateVideoResponse;
      const generatedSamples = generateVideoResponse?.generatedSamples;
      
      if (generatedSamples && generatedSamples.length > 0) {
        const video = generatedSamples[0].video;
        
        if (video && video.uri) {
          console.log("\nDownloading video from:", video.uri);
          const videoData = await downloadVideo(video.uri, API_KEY);
          const outputPath = path.join(__dirname, "santa-video.mp4");
          fs.writeFileSync(outputPath, Buffer.from(videoData));
          console.log(`\n🎅 ✅ Saved video to santa-video.mp4`);
          console.log("\nOpen the santa-video-app folder to view your video!");
        } else {
          console.log("\nNo video URI found in response");
          console.log(JSON.stringify(result, null, 2));
        }
      } else {
        console.log("\nNo generated samples in response");
        console.log(JSON.stringify(result, null, 2));
      }
    } else {
      console.log("\n⏱️ Timed out or error. Last result:");
      console.log(JSON.stringify(result, null, 2));
    }

  } catch (error) {
    console.log("❌ Error:");
    console.log(error.message);
  }
}

generateVideo();
