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