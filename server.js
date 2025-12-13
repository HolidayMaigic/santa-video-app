require("dotenv").config();
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { GoogleGenAI } = require("@google/genai");
const { Resend } = require("resend");

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Google AI
const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

// Initialize Resend for emails
const resend = new Resend(process.env.RESEND_API_KEY);

// Store orders in memory (in production, use a database)
const orders = new Map();
const pendingUploads = new Map(); // Store uploads before payment

// Set up file upload
const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/jpg"];
    cb(null, allowed.includes(file.mimetype));
  },
});

// Create directories if they don't exist
if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");
if (!fs.existsSync("outputs")) fs.mkdirSync("outputs");

// Serve static files
app.use(express.static("public"));
app.use("/outputs", express.static("outputs"));

// Parse JSON for most routes
app.use((req, res, next) => {
  if (req.originalUrl === "/webhook") {
    next();
  } else {
    express.json()(req, res, next);
  }
});

// Landing page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Handle pre-payment photo upload
app.post("/pre-upload", upload.single("photo"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No photo uploaded" });
  }

  // Generate a unique ID for this upload
  const uploadId = `upload_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // Store the upload info
  pendingUploads.set(uploadId, {
    filePath: req.file.path,
    originalName: req.file.originalname,
    created: new Date(),
  });

  // Clean up old pending uploads (older than 1 hour)
  const oneHourAgo = Date.now() - (60 * 60 * 1000);
  for (const [id, data] of pendingUploads) {
    if (data.created.getTime() < oneHourAgo) {
      try { fs.unlinkSync(data.filePath); } catch (e) {}
      pendingUploads.delete(id);
    }
  }

  res.json({ success: true, uploadId });
});

// Create checkout session (now includes uploadId)
app.post("/create-checkout", async (req, res) => {
  const { uploadId, email } = req.body;

  if (!uploadId || !pendingUploads.has(uploadId)) {
    return res.status(400).json({ error: "Please upload a photo first" });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Santa Magic Video",
              description: "A personalized video of Santa in your home!",
            },
            unit_amount: 500, // $5.00 in cents
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${process.env.BASE_URL}/processing?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.BASE_URL}/`,
      customer_email: email || undefined,
      metadata: {
        uploadId: uploadId,
        email: email || "",
      },
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error("Checkout error:", error);
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

// Processing page (after payment)
app.get("/processing", async (req, res) => {
  const sessionId = req.query.session_id;

  if (!sessionId) {
    return res.redirect("/");
  }

  try {
    // Verify the payment was successful
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== "paid") {
      return res.redirect("/");
    }

    const uploadId = session.metadata.uploadId;
    const email = session.metadata.email || session.customer_details?.email;
    const pendingUpload = pendingUploads.get(uploadId);

    if (!pendingUpload) {
      console.error("Upload not found:", uploadId);
      return res.redirect("/?error=upload_not_found");
    }

    // Check if we already started processing this order
    if (!orders.has(sessionId)) {
      // Store the order
      orders.set(sessionId, {
        email: email,
        photoPath: pendingUpload.filePath,
        status: "processing",
        created: new Date(),
      });

      // Remove from pending uploads
      pendingUploads.delete(uploadId);

      // Start processing in background
      processVideo(sessionId, orders.get(sessionId).photoPath, email);
    }

    res.sendFile(path.join(__dirname, "public", "processing.html"));
  } catch (error) {
    console.error("Session verification error:", error);
    res.redirect("/");
  }
});

// Check order status
app.get("/status/:sessionId", (req, res) => {
  const order = orders.get(req.params.sessionId);

  if (!order) {
    return res.status(404).json({ error: "Order not found" });
  }

  res.json({
    status: order.status,
    videoUrl: order.videoUrl || null,
    error: order.error || null,
  });
});

// Stripe webhook (for payment confirmation)
app.post("/webhook", express.raw({ type: "application/json" }), (req, res) => {
  const sig = req.headers["stripe-signature"];

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    console.log("Payment completed for session:", session.id);
  }

  res.json({ received: true });
});

// Video processing function
async function processVideo(sessionId, photoPath, email) {
  const order = orders.get(sessionId);

  try {
    console.log(`\n🎅 Starting video creation for order ${sessionId}`);

    // Step 1: Add Santa to the photo
    console.log("Step 1: Adding Santa to photo...");
    order.status = "adding_santa";

    const imageData = fs.readFileSync(photoPath);
    const base64Image = imageData.toString("base64");

    const imageResponse = await ai.models.generateContent({
      model: "gemini-2.0-flash-exp",
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
              text: "Take this exact photograph and add a Santa Clause kneeling by the tree, he has his big bag of gifts sitting beside him, he's placing presents around the tree. We can only see him from behind. Keep everything else in the photo the same. No music, no audio, no speaking.",
            },
          ],
        },
      ],
      config: {
        responseModalities: ["image", "text"],
      },
    });

    // Extract the generated image
    let santaImageBase64 = null;
    if (imageResponse.candidates && imageResponse.candidates[0]) {
      const parts = imageResponse.candidates[0].content.parts;
      for (const part of parts) {
        if (part.inlineData) {
          santaImageBase64 = part.inlineData.data;
          break;
        }
      }
    }

    if (!santaImageBase64) {
      throw new Error("Failed to generate Santa image");
    }

    // Save the Santa image
    const santaImagePath = path.join("outputs", `${sessionId}-santa.jpg`);
    fs.writeFileSync(santaImagePath, Buffer.from(santaImageBase64, "base64"));
    console.log("✅ Santa added to photo!");

    // Step 2: Generate video
    console.log("Step 2: Generating video...");
    order.status = "generating_video";

    const operation = await ai.models.generateVideos({
      model: "veo-3.1-generate-preview",
      prompt:
        "a video of santa clause placing presents under the christmas tree. He's taking gifts out of his big bag of gifts and placing them around the tree. No speaking, no audio, no music.",
      image: {
        imageBytes: santaImageBase64,
        mimeType: "image/jpeg",
      },
      config: {
        aspectRatio: "16:9",
        numberOfVideos: 1,
      },
    });

    console.log("Video generation started, polling for completion...");

    // Poll for completion
    let result;
    let attempts = 0;
    const maxAttempts = 60;

    while (attempts < maxAttempts) {
      attempts++;
      await new Promise((resolve) => setTimeout(resolve, 5000));

      const pollUrl = `https://generativelanguage.googleapis.com/v1beta/${operation.name}`;
      const pollResponse = await fetch(pollUrl, {
        headers: { "x-goog-api-key": process.env.GOOGLE_API_KEY },
      });
      result = await pollResponse.json();

      if (result.done) break;
      console.log(`  Waiting for video... (attempt ${attempts})`);
    }

    if (!result || !result.done) {
      throw new Error("Video generation timed out");
    }

    // Download the video
    const videoUri =
      result.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;

    if (!videoUri) {
      throw new Error("No video URI in response");
    }

    console.log("Downloading video...");
    const videoResponse = await fetch(videoUri, {
      headers: { "x-goog-api-key": process.env.GOOGLE_API_KEY },
    });
    const videoBuffer = await videoResponse.arrayBuffer();

    const videoPath = path.join("outputs", `${sessionId}-video.mp4`);
    fs.writeFileSync(videoPath, Buffer.from(videoBuffer));

    // Update order status
    order.status = "complete";
    order.videoUrl = `/outputs/${sessionId}-video.mp4`;

    console.log(`\n🎉 Video complete! ${order.videoUrl}`);

    // Clean up uploaded photo
    try { fs.unlinkSync(photoPath); } catch (e) {}

    // Send email notification
    if (email) {
      await sendCompletionEmail(email, `${process.env.BASE_URL}${order.videoUrl}`);
    }

  } catch (error) {
    console.error("Video processing error:", error);
    order.status = "error";
    order.error = error.message;
  }
}

// Send completion email
async function sendCompletionEmail(email, videoUrl) {
  try {
    console.log(`Sending completion email to: ${email}`);
    
    await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to: email,
      subject: "🎅 Your Santa Magic Video is Ready!",
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { text-align: center; padding: 30px 0; }
            .header h1 { color: #1a472a; margin: 0; }
            .content { background: #f9f9f9; border-radius: 10px; padding: 30px; text-align: center; }
            .button { display: inline-block; background: #c62828; color: white; padding: 15px 30px; text-decoration: none; border-radius: 50px; font-weight: bold; margin: 20px 0; }
            .footer { text-align: center; padding: 20px; color: #666; font-size: 14px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🎄 Your Santa Video is Ready! 🎅</h1>
            </div>
            <div class="content">
              <p>Great news! Your personalized Santa Magic Video has been created and is ready to download.</p>
              <p>Click the button below to view and download your video:</p>
              <a href="${videoUrl}" class="button">🎬 Watch Your Video</a>
              <p style="margin-top: 30px; font-size: 14px; color: #666;">
                This link will be available for 7 days. Make sure to download your video!
              </p>
            </div>
            <div class="footer">
              <p>Made with ❤️ by Santa Magic Video</p>
              <p>Spreading Christmas joy, one video at a time! 🎄</p>
            </div>
          </div>
        </body>
        </html>
      `,
    });

    console.log("✅ Email sent successfully!");
  } catch (error) {
    console.error("Failed to send email:", error);
  }
}

// Start server
app.listen(PORT, () => {
  console.log(`\n🎄 Santa Video App running at http://localhost:${PORT}\n`);
});
