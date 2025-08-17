import { Boom } from "@hapi/boom"
import {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  makeWASocket,
  MessageUpsertType,
  proto,
  WAMessage,
  WAMessageUpdate,
} from "@whiskeysockets/baileys"
import axios from "axios"
import cors from "cors"
import dotenv from "dotenv"
import express from "express"
import https from "https"
import pino from "pino"
const ffmpeg = require("fluent-ffmpeg")
const fs = require("fs").promises

ffmpeg.setFfmpegPath("./ffmpeg.exe") // Defina o caminho para o executável do ffmpeg

// const {
//   makeWASocket,
//   makeCacheableSignalKeyStore,
//   fetchLatestBaileysVersion,
//   downloadMediaMessage,
// } = require("@whiskeysockets/Baileys");
const { useMySQLAuthState } = require("mysql-baileys")

import path from "path"
import { Mensagem, ResponseData, WhatsAppClient } from "./types"

dotenv.config()

const apiUrl = process.env.API_URL || ""

const api = axios.create({
  baseURL: apiUrl,
  httpsAgent: new https.Agent({
    rejectUnauthorized: false,
  }),
})

const app = express()
app.use(express.json({ limit: "50mb" }))
app.use(cors())
const port = 3000

const EventType = {
  LOADING_SCREEN: 0,
  QR: 1,
  AUTHENTICATED: 2,
  AUTH_FAILURE: 3,
  READY: 4,
  MESSAGE: 5,
  MESSAGE_ACK: 6,
  CHANGE_STATE: 7,
  DISCONNECTED: 8,
}

let vListaContasMemoria = [] as WhatsAppClient[] // Array para armazenar as instâncias de Clientes

// Função para buscar o cliente pelo conta_id
function getClientByWhatsAppId(conta_id: string) {
  const clientObj = vListaContasMemoria.find(
    (client) => client.conta_id === conta_id
  )

  return clientObj ? clientObj.client : null
}

function enviarEventoApi(
  conta_id: string,
  eventType: number,
  eventData: object
) {
  const currentDateTime = new Date().toLocaleString()

  const payload = {
    conta_id: conta_id,
    eventType: eventType,
    ...eventData,
  }
  console.log(`[${currentDateTime}] ` + "Enviando evento para a API:", payload)

  api
    .post("WhatsAppConta/webhook", payload)
    .then((res) => {})
    .catch(function (error) {
      console.log(error)
    })
}

function getListaContas() {
  const currentDateTime = new Date().toLocaleString()

  console.log(`[${currentDateTime}] ` + "Atualizando lista de contas")

  api
    .get("WhatsAppConta/Lista")
    .then(function (response) {
      response.data.forEach((conta_id: string) => {
        try {
          console.log(`[${currentDateTime}] ` + "Verificando conta:", conta_id)

          var vConta = getClientByWhatsAppId(conta_id)

          if (!vConta) {
            console.log(
              `[${currentDateTime}] ` +
                "Cliente não encontrado. Criando novo cliente: ",
              conta_id
            )

            createWhatsAppClient(conta_id)
          }
        } catch (error) {
          enviarEventoApi(conta_id, EventType.DISCONNECTED, {
            body: `Conta desconectada: ${
              error instanceof Error ? error.message : "Erro desconhecido"
            }`,
          })

          console.error(
            `[${currentDateTime}] ` + `Erro ao atualizar cliente ${conta_id}: `,
            error
          )
        }
      })
    })
    .catch(function (error) {
      console.log(
        `[${currentDateTime}] ` + "Erro ao obter lista de contas:",
        error
      )
    })
}

function enviarMensagem(conta_id: string, velocidadeEnvio = 1) {
  /*const currentDateTime = new Date().toLocaleString()

  console.log(`[${currentDateTime}] Enviando mensagens:`, conta_id)

  api
    .post(`WhatsAppConta/Enviar/${conta_id}`)
    .then((response) => {
      console.log(`[${currentDateTime}] Mensagem enviada:`, conta_id)
      velocidadeEnvio = response.data.velocidade_envio || 1
    })
    .catch((error) => {
      console.log(
        `[${currentDateTime}] Erro ao enviar mensagens:`,
        conta_id,
        error
      )
    })
    .finally(() => {
      const tempos = {
        1: { min: 60, max: 110 }, // Lento
        2: { min: 30, max: 60 }, // Médio
        3: { min: 10, max: 30 }, // Rápido
      }

      const { min, max } = tempos[velocidadeEnvio as keyof typeof tempos]
      const randomTimeout = (Math.random() * (max - min) + min) * 1000

      // console.log(
      //   `[${new Date().toLocaleString()}] Próximo envio conta ${conta_id} em ${randomTimeout / 1000} segundos`
      // );

      setTimeout(() => enviarMensagem(conta_id, velocidadeEnvio), randomTimeout)
    })
      */
}

async function createWhatsAppClient(conta_id: string) {
  const currentDateTime = new Date().toLocaleString()

  const logger = pino({ level: "info" }) as any // Inicializa o logger com nível de info
  const { error, version } = await fetchLatestBaileysVersion() // Obtém a versão mais recente do Baileys

  if (error) {
    console.log(`Sessão: ${conta_id} | Sem conexão, verifique sua internet.`)
    return createWhatsAppClient(conta_id) // Tenta reconectar se houver um erro
  }

  // Configura o estado de autenticação usando MySQL
  const { state, saveCreds, removeCreds } = await useMySQLAuthState({
    session: `${conta_id}`,
    host: process.env.DB_HOST,
    port: 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    tableName: "whatsapp_auth",
  })

  // Cria o socket do WhatsApp
  const sock = makeWASocket({
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    version: version,
    defaultQueryTimeoutMs: undefined,
    browser: Browsers.macOS("Desktop"),
    printQRInTerminal: true,
    logger: logger,
  })

  // Evento para salvar as credenciais quando atualizadas
  sock.ev.on("creds.update", saveCreds)

  // Evento para monitorar o estado da conexão
  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update
    if (connection === "close" && lastDisconnect) {
      const statusCode = (lastDisconnect.error as Boom)?.output?.statusCode
      const statusMessage =
        (lastDisconnect.error as Boom)?.output?.payload?.message ?? ""
      const shouldReconnect =
        statusCode !== DisconnectReason.loggedOut &&
        statusCode !== DisconnectReason.forbidden &&
        !statusMessage.includes("QR refs attempts ended")

      console.log(
        "Conta: ",
        conta_id,
        " ",
        sock?.user?.id,
        " conexão fechada devido a ",
        lastDisconnect.error,
        ", reconectando ",
        shouldReconnect
      )
      // Reconecta se não estiver deslogado
      if (shouldReconnect) {
        try {
          createWhatsAppClient(conta_id)
        } catch (error) {
          console.log(`[${currentDateTime}] Erro ao reconectar ${error}.`)
          DestroyClient(conta_id)
        }
      } else {
        removeCreds(`${conta_id}`)
        console.log(`[${currentDateTime}] Logout detectado.`)
        DestroyClient(conta_id)
        enviarEventoApi(conta_id, EventType.DISCONNECTED, {
          body: "Usuário fez logout",
        })
      }
    } else if (connection === "open") {
      console.log("conexão aberta", sock.user?.id)
      try {
        const profile = await sock.profilePictureUrl(
          sock.user?.id ?? "",
          "image"
        )
        const celular = sock.user?.id.split(":")[0]

        await api.post("WhatsAppConta/AtualizarConta", {
          id: conta_id,
          telefone: celular,
          foto: profile,
        })
      } catch (error) {
        console.error("Erro ao obter informações do perfil:", error)
      }
      const idx = vListaContasMemoria.findIndex((c) => c.conta_id === conta_id)
      if (idx !== -1) vListaContasMemoria[idx].pronto = true
      enviarEventoApi(conta_id, EventType.READY, {})
    } else if (qr) {
      // Armazenar o QR Code no cliente para acesso via endpoint
      const idx = vListaContasMemoria.findIndex((c) => c.conta_id === conta_id)
      if (idx !== -1) {
        vListaContasMemoria[idx].ultimoQr = qr
      }
      
      enviarEventoApi(conta_id, EventType.QR, { body: qr })
    }
  })

  // Evento para lidar com novas mensagens
  sock.ev.on(
    "messages.upsert",
    async ({
      messages,
      type,
    }: {
      messages: WAMessage[]
      type: MessageUpsertType
    }) => {
      try {
        // Verifica se a mensagem é nula ou vazia
        if (!messages || messages.length === 0) {
          return
        }

        for (const m of messages) {
          const isGroup = m.key.remoteJid?.endsWith("@g.us")

          // Se for enviado "!mencionar" deve pegar todos os participantes do grupo e mencionar todos
          if (isGroup) {
            if (
              m.message?.conversation === "!mencionar" ||
              m.message?.extendedTextMessage?.text === "!mencionar"
            ) {
              const groupMetadata = await sock.groupMetadata(
                m.key?.remoteJid ?? ""
              )

              const participants = groupMetadata.participants.map((p) => p.id)

              const mentionText = participants
                .map((p) => `@${p.split("@")[0]}`)
                .join(" ")

              // Envia a mensagem mencionando todos os participantes
              await sock.sendMessage(m.key?.remoteJid ?? "", {
                text: mentionText,
                mentions: participants,
              })
            }
          }

          if (isGroup) {
            if (
              m.message?.conversation === "!mencionar_oculto" ||
              m.message?.extendedTextMessage?.text === "!mencionar_oculto"
            ) {
              try {
                const groupMetadata = await sock.groupMetadata(
                  m.key?.remoteJid ?? ""
                )
                const participants = groupMetadata.participants.map((p) => p.id)

                // Envia a mensagem mencionando todos os participantes de forma oculta
                await sock.sendMessage(m.key?.remoteJid ?? "", {
                  text: "",
                  mentions: participants,
                })
              } catch (error) {
                console.error("Erro ao obter os participantes do grupo:", error)
              }
            }
          }

          // Se não tiver mensagem, não seguir
          if (!m || !m.message) return

          // Não seguir se for uma mensagem enviada por mim
          if (m.key.fromMe) {
            return
          }

          // Não seguir se for um grupo
          if (isGroup) return

          console.log(
            `[${new Date().toLocaleString()}] Mensagem recebida:`,
            m.message.conversation
          )

          console.log(JSON.stringify(m, undefined, 2))

          let vMensagem: Mensagem = {
            id: m.key.id,
            from: m.key.remoteJid,
            timestamp: m.messageTimestamp,
            body: m.message.conversation,
            type: "text",
          }

          const messageType = Object.keys(m.message)[0] // get what type of message it is -- text, image, video

          if (messageType === "imageMessage") {
            return
            /*

            vMensagem.type = "image";
            const buffer = await downloadMediaMessage(
              m,
              "buffer",
              {},
              {
                logger,
                reuploadRequest: sock.updateMediaMessage,
              }
            );
            vMensagem.media = {
              data: buffer.toString("base64"),
              mimetype: m.message.imageMessage?.mimetype ?? "image/jpeg",
            };
            */
          } else if (messageType === "videoMessage") {
            return
            /*

            vMensagem.type = "video";
            const buffer = await downloadMediaMessage(
              m,
              "buffer",
              {},
              {
                logger,
                reuploadRequest: sock.updateMediaMessage,
              }
            );
            vMensagem.media = {
              data: buffer.toString("base64"),
              mimetype: m.message.videoMessage?.mimetype ?? "video/mp4",
            };
            */
          } else if (messageType === "extendedTextMessage") {
            vMensagem.body = m.message.extendedTextMessage?.text
            vMensagem.contextID =
              m.message.extendedTextMessage?.contextInfo?.stanzaId
          }

          enviarEventoApi(conta_id, EventType.MESSAGE, vMensagem)
        }
      } catch (err) {
        logger.error({ err }, "falha ao decifrar a mensagem")
      }
    }
  )

  // Evento para lidar com atualizações de mensagens (recebidas/lidas)
  sock.ev.on("messages.update", (updates: WAMessageUpdate[]) => {
    for (const { key, update } of updates) {
      if (update.status) {
        enviarEventoApi(conta_id, EventType.MESSAGE_ACK, {
          id: key.id,
          from: key.remoteJid,
          timestamp: update.messageTimestamp,
          type: "status",
          status:
            update.status === proto.WebMessageInfo.Status.DELIVERY_ACK
              ? 2
              : update.status === proto.WebMessageInfo.Status.READ ||
                update.status === proto.WebMessageInfo.Status.PLAYED
              ? 3
              : update.status === proto.WebMessageInfo.Status.PENDING
              ? 1
              : -1,
        })
        console.log(key, update)
      }
    }
  })

  const index = vListaContasMemoria.findIndex(
    (client) => client.conta_id === conta_id
  )

  // Se o cliente já existir, atualiza o cliente
  // Se não existir, adiciona um novo cliente
  if (index !== -1) {
    vListaContasMemoria[index] = {
      conta_id: conta_id,
      client: sock,
      pronto: false,
    }
  } else {
    enviarMensagem(conta_id)
    vListaContasMemoria.push({
      conta_id: conta_id,
      client: sock,
      pronto: false,
    })
  }
}

async function DestroyClient(conta_id: string) {
  const currentDateTime = new Date().toLocaleString()
  console.log(`[${currentDateTime}] Destruindo cliente para conta ${conta_id}`)

  const client = getClientByWhatsAppId(conta_id)
  if (!client) {
    console.log(
      `[${currentDateTime}] Cliente não encontrado para conta ${conta_id}`
    )
    return
  }

  try {
    // Destrói o cliente e fecha o navegador
    console.log(`[${currentDateTime}] Cliente destruído para conta ${conta_id}`)

    // Remove o cliente da lista em memória
    vListaContasMemoria = vListaContasMemoria.filter(
      (c) => c.conta_id !== conta_id
    )
  } catch (err) {
    console.error(
      `[${currentDateTime}] Erro ao destruir cliente ${conta_id}:`,
      err
    )
    await enviarEventoApi(conta_id, EventType.DISCONNECTED, {
      body: `Erro ao desconectar conta: ${
        err instanceof Error ? err.message : "Erro desconhecido"
      }`,
    })
  }
}

async function ConverterAudio(mediaBuffer: Buffer<ArrayBuffer>) {
  const GerarNome = Math.random().toString(36).substring(2, 15)

  const inputPath = path.join(__dirname, `${GerarNome}.mp4`) // Arquivo temporário de entrada
  const outputPath = path.join(__dirname, `${GerarNome}.ogg`) // Arquivo temporário de saída

  try {
    // Salva o buffer como arquivo temporário
    await fs.writeFile(inputPath, mediaBuffer)

    // Converte o áudio usando ffmpeg
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .audioCodec("libopus") // Codec Opus
        .audioChannels(1) // Mono
        .outputOptions("-avoid_negative_ts make_zero") // Ajuste de timestamps
        .toFormat("ogg") // Formato OGG
        .save(outputPath)
        .on("end", resolve)
        .on("error", reject)
    })

    // Lê o arquivo convertido como buffer
    mediaBuffer = await fs.readFile(outputPath)
  } catch (error) {
    console.error("Erro ao converter áudio:", error)
    throw error
  } finally {
    // Remove arquivos temporários
    await fs.unlink(inputPath).catch(() => {})
    await fs.unlink(outputPath).catch(() => {})
  }

  return mediaBuffer // Retorna o buffer convertido
}

app.get("/", (req, res) => {
  res.send({ cod: 0, msg: "ok" })
})

app.post("/add", (req, res) => {
  const { conta_id } = req.body

  const currentDateTime = new Date().toLocaleString()

  console.log(`[${currentDateTime}] ` + "Adicionando conta:", conta_id)

  if (getClientByWhatsAppId(conta_id)) {
    res.status(400).json({ cod: 1, msg: "Conta já cadastrada" })
  } else {
    createWhatsAppClient(conta_id)
    res.json({ cod: 0, msg: "OK" })
  }
})

app.post("/init", async (req, res) => {
  const conta_id = req.body.conta_id

  const client = getClientByWhatsAppId(conta_id)

  const currentDateTime = new Date().toLocaleString()

  console.log(`[${currentDateTime}] ` + "Iniciando cliente:", conta_id)

  if (!client) {
    console.log(
      `[${currentDateTime}] ` + "Cliente não encontrado. Criando novo cliente",
      conta_id
    )

    createWhatsAppClient(conta_id)
  }

  res.status(200).send({ cod: 0, msg: "OK" })
})

app.post("/seen", async (req, res) => {
  const client = getClientByWhatsAppId(req.body.conta_id)

  const currentDateTime = new Date().toLocaleString()

  if (client) {
    try {
      const key = {
        remoteJid: `${req.body.to}@g.us`,
        //id: "AHASHH123123AHGA", // id of the message you want to read
      }
      // pass to readMessages function
      // can pass multiple keys to read multiple messages as well
      await client.readMessages([key])
    } catch (error) {
      console.error(
        `[${currentDateTime}] ` + "Erro ao marcar mensagem como visualizada:",
        error
      )
      res.status(400).send({ cod: 1, msg: error })
    }
  }

  res.status(200).send({ cod: 0, msg: "OK" })
})

app.get("/ping", (req, res) => {
  const vRetorno = {
    status: "ok",
    hora: new Date().toLocaleString(),
    contas: vListaContasMemoria?.map((client) => {
      return {
        conta_id: client.conta_id,
        pronto: client.pronto,
      }
    }),
  }

  res.send(vRetorno)
})

// Endpoint para buscar último QR Code gerado
app.get("/qr/:contaId", (req, res) => {
  const contaId = req.params.contaId
  const cliente = vListaContasMemoria.find(c => c.conta_id === contaId)
  
  if (!cliente) {
    return res.status(404).send({ cod: 1, msg: "Conta não encontrada" })
  }
  
  if (cliente.ultimoQr) {
    return res.status(200).send({ 
      cod: 0, 
      qr: cliente.ultimoQr,
      status: cliente.pronto ? 'conectado' : 'aguardando_qr'
    })
  } else {
    return res.status(404).send({ 
      cod: 1, 
      msg: "QR Code não disponível. Inicie a conexão primeiro.",
      status: cliente.pronto ? 'conectado' : 'sem_qr'
    })
  }
})

app.post("/send", async (req, res) => {
  const vRetorno: ResponseData = { cod: 0, msg: "" }
  const vDadosMensagem: Mensagem = req.body
  const currentDateTime = new Date().toLocaleString()

  // Validação inicial
  if (
    !vDadosMensagem.conta_id ||
    !vDadosMensagem.to ||
    !vDadosMensagem.type ||
    (!vDadosMensagem.body && !vDadosMensagem.media)
  ) {
    console.error(`[${currentDateTime}] Dados inválidos:`, vDadosMensagem)
    res.status(422).send({ cod: 1, msg: "Dados obrigatórios ausentes" })
    return
  }

  console.log(`[${currentDateTime}] ` + "Enviando mensagem:", vDadosMensagem)

  const client = getClientByWhatsAppId(vDadosMensagem.conta_id)
  if (!client) {
    res.status(400).send({ cod: 1, msg: "Conta não encontrado" })
    return
  }

  try {
    // Verifica se o número está registrado no WhatsApp
    const result = await client.onWhatsApp(vDadosMensagem.to)

    if (!result?.[0].exists) {
      console.error(
        `[${currentDateTime}] Número não registrado no WhatsApp: ${vDadosMensagem.to}`
      )
      res.status(400).send({ cod: 1, msg: "Número não registrado no WhatsApp" })
      return
    }

    const vNumero = result?.[0].jid

    await client.sendPresenceUpdate("available", vNumero) // Indica que o cliente está online

    let vMsg: proto.WebMessageInfo | undefined

    if (vDadosMensagem.type === "text") {
      await client.sendPresenceUpdate("composing", vNumero)

      // Delay baseado no tamanho do texto, com limites
      const delay = Math.min(
        Math.max(60 * (vDadosMensagem.body?.length ?? 0), 500),
        3000
      )
      await new Promise((resolve) => setTimeout(resolve, delay))

      // Se tiver media, enviar a mensagem com a media
      if (vDadosMensagem.media?.data) {
        vDadosMensagem.type = "media"
      } else {
        vMsg = await client.sendMessage(vNumero, { text: vDadosMensagem.body! })
      }
    }

    if (vDadosMensagem.type === "media" && vDadosMensagem.media) {
      // Converte a string base64 para um buffer de dados
      let mediaBuffer = Buffer.from(vDadosMensagem.media.data, "base64")
      const mediaType = vDadosMensagem.media.mimetype.includes("image")
        ? "image"
        : vDadosMensagem.media.mimetype.includes("video")
        ? "video"
        : vDadosMensagem.media.mimetype.includes("audio")
        ? "audio"
        : "document"

      if (mediaType === "audio") {
        mediaBuffer = await ConverterAudio(mediaBuffer)

        // Atualiza o mimetype para o novo formato
        vDadosMensagem.media.mimetype = "audio/ogg"
      }

      // Envia a mensagem com o arquivo de áudio
      vMsg = await client.sendMessage(vNumero, {
        [mediaType]: mediaBuffer,
        // mimetype: vDadosMensagem.media.mimetype,
        fileName: vDadosMensagem.media.filename ?? "Anexo",
        caption: vDadosMensagem.body ?? "",
      } as any)
    }

    console.log("Retorno do envio: ", vMsg)
    vRetorno.msg = vMsg?.key.id ?? ""
    await client.sendPresenceUpdate("available", vNumero)
  } catch (error) {
    const currentDateTime = new Date().toLocaleString()

    if (error instanceof Error) {
      console.error(`[${currentDateTime}] ` + "Erro ao enviar mensagem:", error)
      vRetorno.cod = 1
      vRetorno.msg = error.message
    } else {
      console.error(
        `[${currentDateTime}] ` + "Erro desconhecido ao enviar mensagem:",
        error
      )
      vRetorno.cod = 1
      vRetorno.msg = "Erro desconhecido"
    }
  }

  res.send(vRetorno)
})

app.listen(port, () => {
  console.log(`[${Date.now()}] ` + `API WhatsApp iniciada na porta ${port}`)

  // Inicializar getListaContas quando a API é iniciada
  getListaContas()

  //atualizar contas a cada 2 minutos
  setInterval(() => {
    getListaContas()
  }, 120000)
})
