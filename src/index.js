import dotenv from 'dotenv'
dotenv.config()

import http from 'http'
import { startWhatsApp, onMessage, sendMessage } from './whatsapp/connection.js'
import { generateResponse } from './ai/deepseek.js'
import { saveMessage, getHistory } from './db/supabase.js'

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
    await saveMessage(phoneNumber, 'user', text, pushName)
    const history = await getHistory(phoneNumber)
    const response = await generateResponse(history, {}, pushName)
    await saveMessage(phoneNumber, 'assistant', response, null)
    await sendMessage(phoneJid, response)
    console.log(`Bubba replied to ${phoneNumber}`)
  } catch (err) {
    console.error('Error processing message:', err)
    await sendMessage(phoneJid, "Hey, give me a second and try again?")
  }
})

startWhatsApp().catch(console.error)