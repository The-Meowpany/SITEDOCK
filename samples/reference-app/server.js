const http = require("node:http");

const REVISION = "1";

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok", revision: REVISION }));
    return;
  }

  res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  res.end(`SiteDock reference app revision=${REVISION} path=${req.url}\n`);
});

server.listen(Number(process.env.PORT) || 8080, "0.0.0.0");
