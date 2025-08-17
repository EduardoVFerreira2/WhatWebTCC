import { WASocket } from "@whiskeysockets/baileys"

export interface WhatsAppMedia {
  filename?: string
  data: string
  mimetype: string
}

export interface Mensagem {
  id?: string | null
  from?: string | null
  to?: string | null
  timestamp?: number | Long | null
  body?: string | null
  type?: string | null
  deviceType?: string | null
  buttons?: boolean | null
  media?: WhatsAppMedia | null
  contextID?: string | null
  conta_id?: string | null
}

export interface WhatsAppClient {
  conta_id: string
  client: WASocket
  pronto: boolean
  ultimoQr?: string
}

export interface ResponseData {
  cod: number
  msg: string
}
