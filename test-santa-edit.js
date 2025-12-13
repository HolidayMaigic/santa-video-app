const { GoogleGenAI } = require("@google/genai");
const fs = require("fs");
const path = require("path");

const API_KEY = "AIzaSyDis1BXBxZTNohVApZXfqcapCSmEYGfjhg";

const ai = new GoogleGenAI({ apiKey: API_KEY });

async function addSantaToPhoto() {
  console.log("Loading your photo...\n");

  // Read the image file
  const imagePath = path.join(__dirname, "Test-photo.jpg");
  const imageData = fs.readFileSync(imagePath);
  const base64Image = imageData.toString("base64");

  console.log("Sending to Nano Banana to add Santa...\n");

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash-exp-image-generation",
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: base64Image,
              },
            },
            {
              text: "Edit this photo to add Santa Claus into the scene. Make it look realistic, as if Santa was actually there. Keep everything else in the photo the same.",
            },
          ],
        },
      ],
      config: {
        responseModalities: ["image", "text"],
      },
    });

    console.log("✅ Got response from API!");
    
    // Check if we got image data back
    if (response.candidates && response.candidates[0] && response.candidates[0].content) {
      const parts = response.candidates[0].content.parts;
      
      for (const part of parts) {
        if (part.inlineData) {
          console.log("\n🎅 Got an image back! Saving...");
          const imageBuffer = Buffer.from(part.inlineData.data, "base64");
          const outputPath = path.join(__dirname, "santa-output.jpg");
          fs.writeFileSync(outputPath, imageBuffer);
          console.log("✅ Saved to santa-output.jpg");
        } else if (part.text) {
          console.log("\nText response:", part.text);
        }
      }
    } else {
      console.log("\nFull response:");
      console.log(JSON.stringify(response, null, 2));
    }

  } catch (error) {
    console.log("❌ Error:");
    console.log(error.message);
    console.log("\nFull error:");
    console.log(JSON.stringify(error, null, 2));
  }
}

addSantaToPhoto();
