const { GoogleGenAI } = require("@google/genai");

// Replace this with your actual API key
const API_KEY = "AIzaSyDis1BXBxZTNohVApZXfqcapCSmEYGfjhg";

const ai = new GoogleGenAI({ apiKey: API_KEY });

async function testNanoBanana() {
  console.log("Testing Nano Banana API...\n");

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash-exp",
      contents: [
        {
          role: "user",
          parts: [{ text: "Say 'Hello! Nano Banana is working!' and nothing else." }],
        },
      ],
    });

    console.log("✅ Success! Response from API:");
    console.log(response.candidates[0].content.parts[0].text);
  } catch (error) {
    console.log("❌ Error:");
    console.log(error.message);
  }
}

testNanoBanana();