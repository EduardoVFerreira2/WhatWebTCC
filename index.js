const express = require("express");
var cors = require("cors");
const axios = require("axios");
const https = require("https");
require("dotenv").config();
const qrcode = require("qrcode-terminal");

const apiUrl = process.env.API_URL;

const api = axios.create({
  baseURL: apiUrl,
  httpsAgent: new https.Agent({ rejectUnauthorized: false }),
});

const app = express();
app.use(express.json({ limit: "50mb" }));
app.use(cors());
const port = 3000;

const { Client, LocalAuth, MessageMedia, Buttons } = require("whatsapp-web.js");

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
};

const vWhatsWeb = []; // Array para armazenar as instâncias de Client

// Função para buscar o cliente pelo conta_id
function getClientByWhatsAppId(conta_id) {
  const clientObj = vWhatsWeb.find((client) => client.conta_id === conta_id);
  return clientObj ? clientObj.client : null;
}

function enviarEventoApi(conta_id, eventType, eventData) {
  const currentDateTime = new Date().toLocaleString();
  console.log(`[${currentDateTime}] Evento ocorrido:`, conta_id);

  const payload = {
    conta_id: conta_id,
    eventType: eventType,
    ...eventData,
  };
  api
    .post("WhatsAppConta/webhook", payload)
    .then(function (response) {
      // Handle response
    })
    .catch(function (error) {
      // console.log(error)
    });
}

function getListaContas() {
  api
    .get("WhatsAppConta/lista")
    .then(function (response) {
      const currentDateTime = new Date().toLocaleString();
      console.log(`[${currentDateTime}] Contas:`, response.data);
      response.data.forEach((conta_id) => {
        if (!getClientByWhatsAppId(conta_id)) createWhatsAppClient(conta_id);
      });
    })
    .catch(function (error) {
      console.log(error);
    });
}

function createWhatsAppClient(conta_id) {
  const client = new Client({
    authStrategy: new LocalAuth({ clientId: `conta-${conta_id}` }),
    puppeteer: {
      headless: true,
      ignoreHTTPSErrors: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--disable-gpu",
      ],
    },
    takeoverOnConflict: true,
    qrMaxRetries: 3,
    webVersionCache: {
      type: "none",
    },
  });

  client.on("loading_screen", (percent, message) => {
    enviarEventoApi(conta_id, EventType.LOADING_SCREEN, {});
  });

  client.on("qr", (qr) => {
    qrcode.generate(qr, { small: true });
    enviarEventoApi(conta_id, EventType.QR, { body: qr });
  });

  client.on("authenticated", () => {
    enviarEventoApi(conta_id, EventType.AUTHENTICATED, {});
  });

  client.on("auth_failure", (msg) => {
    enviarEventoApi(conta_id, EventType.AUTH_FAILURE, { body: msg });
  });

  client.on("ready", () => {
    const index = vWhatsWeb.findIndex((client) => client.conta_id === conta_id);

    if (index !== -1) {
      vWhatsWeb[index].pronto = true;
    }
    enviarEventoApi(conta_id, EventType.READY, {});
    enviarMensagem(conta_id);
  });

  client.on("message", async (msg) => {
    //console.log(msg)
    //Ignorar mensagem em grupos
    if (msg.author) return;

    let vMensagem = {
      id: msg.id.id,
      from: msg.from,
      to: msg.to,
      timestamp: msg.timestamp,
      body: msg.body,
      type: msg.type,
      deviceType: msg.deviceType,
    };

    if (msg.hasMedia) {
      const attachmentData = await msg.downloadMedia();
      vMensagem.media = attachmentData;
    }

    if (msg.hasQuotedMsg) {
      vMensagem.contextID = msg._data.quotedStanzaID;
    }

    enviarEventoApi(conta_id, EventType.MESSAGE, vMensagem);
  });

  client.on("message_ack", async (msg, ack) => {
    let vMensagem = {
      id: msg.id.id,
      from: msg.from,
      to: msg.to,
      timestamp: msg.timestamp,
      body: msg.body,
      type: "status",
      status: ack,
      deviceType: msg.deviceType,
    };

    if (msg.hasMedia) {
      const attachmentData = await msg.downloadMedia();
      vMensagem.media = attachmentData;
    }

    enviarEventoApi(conta_id, EventType.MESSAGE_ACK, vMensagem);
  });

  client.on("change_state", (state) => {
    enviarEventoApi(conta_id, EventType.CHANGE_STATE, { body: state });
  });

  client.on("disconnected", (reason) => {
    enviarEventoApi(conta_id, EventType.DISCONNECTED, { body: reason });
  });

  client.initialize();

  vWhatsWeb.push({ conta_id: conta_id, client: client, pronto: false }); // Adicionar o cliente ao array
}

//Inicializar contas
getListaContas();

app.get("/", (req, res) => res.send({ cod: 0, msg: "ok" }));

app.post("/add", async (req, res) => {
  if (getClientByWhatsAppId(req.body.conta_id)) {
    return res.status(400).send({ cod: 1, msg: "Conta ja cadastrada" });
  } else {
    createWhatsAppClient(req.body.conta_id);
    return res.status(200).send({ cod: 0, msg: "OK" });
  }
});

app.post("/init", async (req, res) => {
  const client = getClientByWhatsAppId(req.body.conta_id);

  if (!client) {
    createWhatsAppClient(req.body.conta_id);
  } else {
    client.initialize();
  }
  return res.status(200).send({ cod: 0, msg: "OK" });
});

app.post("/seen", async (req, res) => {
  const client = getClientByWhatsAppId(req.body.conta_id);

  if (client) {
    await client.sendPresenceAvailable(); //Online

    try {
      const chat = await client.getChatById(`${req.body.to}@c.us`);
      if (chat) {
        await chat.sendSeen(); //Visualizada
        chat.clearState();
      }
    } catch {}
  }
  return res.status(200).send({ cod: 0, msg: "OK" });
});

app.post("/send", async (req, res) => {
  let vRetorno = { cod: 0, msg: "" };
  const client = getClientByWhatsAppId(req.body.conta_id);

  console.log(req.body);

  if (!client) {
    return res.status(400).send({ cod: 1, msg: "Cliente não encontrado" });
  }

  await client.sendPresenceAvailable(); //Online

  let vDadosMensagem = req.body;

  try {
    const chat = await client.getChatById(`${vDadosMensagem.to}@c.us`);
    if (chat) {
      await chat.sendStateTyping(); //Escrevendo...
    }

    if (vDadosMensagem.type === "text") {
      const vMsg = await client.sendMessage(
        `${vDadosMensagem.to}@c.us`,
        vDadosMensagem.body
      );
      vRetorno.msg = vMsg.id.id;
    } else if (vDadosMensagem.type === "media") {
      const media = await new MessageMedia(
        vDadosMensagem.media.mimetype,
        vDadosMensagem.media.data,
        vDadosMensagem.media.filename
      );
      const vMsg = await client.sendMessage(`${vDadosMensagem.to}@c.us`, media);
      vRetorno.msg = vMsg.id.id;
    }
    if (chat) {
      chat.clearState(); //Limpar status
    }
  } catch (error) {
    console.log(error);
    vRetorno.cod = 1;
    vRetorno.msg = error.stack;
  }

  res.send(vRetorno);
});

app.listen(port, () => console.log(`API WhatsApp iniciada na porta ${port}`));
