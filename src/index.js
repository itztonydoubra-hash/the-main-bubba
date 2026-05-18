import dotenv from 'dotenv'
dotenv.config()

import http from 'http'
import { startWhatsApp, onMessage, sendMessage } from './whatsapp/connection.js'
import { generateResponse } from './ai/deepseek.js'

const server = http.createServer((req, res) => {
  res.writeHead(200)
  res.end('Bubba is alive')
})

server.listen(process.env.PORT || 3000, () => {
  console.log('Health check server running')
})

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
  } catch (err) {
    console.error('Error:', err)
    await sendMessage(phoneJid, "Give me a second and try again?")
  }
})

startWhatsApp().catch(console.error)