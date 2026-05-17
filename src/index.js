import dotenv from 'dotenv'
dotenv.config()

import { startWhatsApp, onMessage, sendMessage } from './whatsapp/connection.js'
import { generateResponse } from './ai/deepseek.js'

console.log('Starting Bubba...')

onMessage(async ({ phoneNumber, phoneJid, text, pushName }) => {
  console.log(`Message from ${phoneNumber}: ${text}`)
  
  try {
    const response = await generateResponse(
      [{ role: 'user', content: text }],
      {},
      pushName
    )
    await sendMessage(phoneJid, response)
    console.log(`Bubba replied to ${phoneNumber}`)
  } catch (err) {
    console.error('Error processing message:', err)
    await sendMessage(phoneJid, "Hey, I'm having a moment. Give me a second and try again?")
  }
})

startWhatsApp().catch(console.error)
setInterval(() => {
  console.log("Bubba is alive...");
}, 10000);
import express from "express";

const app = express();

app.get("/", (req, res) => {
  res.send("Bubba is alive 🚀");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});

// keep app alive
setInterval(() => {
  console.log("Still running...");
}, 10000);