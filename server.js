const http = require("http");
const https = require("https");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ALLOWED_ORIGIN = "https://workshop.neurocreator.site";
const TERMINAL_KEY = "1788278749846";
const WORKSHOP_AMOUNT_KOPECKS = 99000; // 990 rubles
const WORKSHOP_DESCRIPTION = "Участие в воркшопе «Нейрокреатор на миллион»";
const PORT = process.env.PORT || 3000;

const rootCa = fs.readFileSync(path.join(__dirname, "russian_trusted_root_ca.pem"), "utf8");
const subCa = fs.readFileSync(path.join(__dirname, "russian_trusted_sub_ca.pem"), "utf8");

function buildToken(params, password) {
  const withPassword = { ...params, Password: password };
  const sortedKeys = Object.keys(withPassword).sort();
  const concat = sortedKeys.map((k) => String(withPassword[k])).join("");
  return crypto.createHash("sha256").update(concat, "utf8").digest("hex");
}

function callTbankInit(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(
      {
        hostname: "securepay.tinkoff.ru",
        path: "/v2/Init",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
        ca: [rootCa, subCa],
      },
      (res) => {
        let chunks = "";
        res.on("data", (c) => (chunks += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(chunks) });
          } catch (e) {
            resolve({ status: res.statusCode, body: { Success: false, Message: "Bad response from T-Bank", Raw: chunks } });
          }
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  const cors = {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  if (req.url !== "/" && req.url !== "/init") {
    res.writeHead(404, { "Content-Type": "application/json", ...cors });
    res.end(JSON.stringify({ Success: false, Message: "Not found" }));
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json", ...cors });
    res.end(JSON.stringify({ Success: false, Message: "Method not allowed" }));
    return;
  }

  try {
    const orderId = "ws-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);

    const initParams = {
      TerminalKey: TERMINAL_KEY,
      Amount: WORKSHOP_AMOUNT_KOPECKS,
      OrderId: orderId,
      Description: WORKSHOP_DESCRIPTION,
    };

    const token = buildToken(initParams, process.env.TBANK_PASSWORD);

    const receipt = {
      Taxation: "usn_income",
      Items: [
        {
          Name: WORKSHOP_DESCRIPTION,
          Price: WORKSHOP_AMOUNT_KOPECKS,
          Quantity: 1,
          Amount: WORKSHOP_AMOUNT_KOPECKS,
          Tax: "none",
        },
      ],
    };

    const initBody = { ...initParams, Token: token, Receipt: receipt };
    const result = await callTbankInit(initBody);

    res.writeHead(200, { "Content-Type": "application/json", ...cors });
    res.end(JSON.stringify(result.body));
  } catch (err) {
    res.writeHead(502, { "Content-Type": "application/json", ...cors });
    res.end(JSON.stringify({ Success: false, Message: "Server error", Error: String(err) }));
  }
});

server.listen(PORT, () => {
  console.log("tbank-init server listening on " + PORT);
});
