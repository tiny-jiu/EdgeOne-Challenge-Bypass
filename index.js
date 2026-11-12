const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const EO = 'https://gcaptcha.eo.qcloud.com';
const SITE = process.argv[2];
if (!SITE) {
  console.error('用法：node index.js <完整目标URL>');
  process.exit(1);
}
let targetUrl;
try {
  targetUrl = new URL(SITE);
  if (!['http:', 'https:'].includes(targetUrl.protocol)) throw new Error();
} catch {
  console.error('目标地址必须是完整的 HTTP 或 HTTPS URL。');
  process.exit(1);
}
const SITE_HOSTNAME = targetUrl.hostname;
const TOKEN_DOMAIN = process.env.EO_TOKEN_DOMAIN || `.${SITE_HOSTNAME.split('.').slice(-2).join('.')}`;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const browserCandidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const CHROME = browserCandidates.find(candidate => fs.existsSync(candidate));
if (!CHROME) {
  throw new Error('未找到 Chrome 或 Edge。请通过 CHROME_PATH 指定 Chromium 内核浏览器的路径。');
}

const log = (...args) => console.log(...args);

async function solveLayer1() {
  for (let round = 0; round < 5; round++) {
    const response = await fetch(SITE, { headers: { 'User-Agent': UA }, redirect: 'manual' });
    const body = await response.text();
    if (body.includes('__tst_status') && body.includes('EO_Bot_Ssid')) {
      const match = body.match(/WTKkN:(\d+),bOYDu:(\d+).*?wyeCN:(\d+)/);
      const sessionMatch = body.match(/\(t,(\d{6,})\)/);
      if (!match || !sessionMatch) throw new Error('无法解析第一层验证内容。');
      const a = BigInt(match[1]);
      const b = BigInt(match[2]);
      const c = BigInt(match[3]);
      const cookies = { __tst_status: String(a + b + c) + '#', EO_Bot_Ssid: sessionMatch[1] };
      log(`[第一层] 正在计算第 ${round + 1} 轮验证。`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      const cookieHeader = Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join('; ');
      const retry = await fetch(SITE, {
        headers: { 'User-Agent': UA, Cookie: cookieHeader }, redirect: 'manual',
      });
      const retryBody = await retry.text();
      if (retryBody.includes('__tst_status') && retryBody.includes('EO_Bot_Ssid')) continue;
      log('[第一层] 验证通过，验证码页面已可访问。');
      return { cookies, pageHtml: retryBody };
    }
    log('[第一层] 当前响应无需计算。');
    return { cookies: {}, pageHtml: body };
  }
  throw new Error('第一层验证在五轮后仍未通过。');
}

class CDP {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 0;
    this.pending = new Map();
    this.handlers = [];
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
    this.ws.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        message.error ? reject(new Error(message.error.message)) : resolve(message.result);
      } else if (message.method) {
        for (const handler of this.handlers) handler(message);
      }
    };
  }

  on(handler) {
    this.handlers.push(handler);
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    this.ws.send(JSON.stringify(message));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  close() {
    try { this.ws.close(); } catch (_) {}
  }
}

async function waitForDevTools(process) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    process.stderr.on('data', data => {
      buffer += data.toString();
      const match = buffer.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) resolve(match[1]);
    });
    process.on('error', reject);
    process.on('exit', () => reject(new Error('浏览器在 CDP 就绪前退出。')));
    setTimeout(() => reject(new Error('等待 DevTools 就绪超时。')), 15000);
  });
}

function generateTrack() {
  const base = Date.now() - 5200 - Math.floor(Math.random() * 1500);
  const track = [[4, 0, 0, base, 0]];
  let previousTime = base;
  let previousX = 300 + Math.random() * 200;
  let previousY = 250 + Math.random() * 150;
  const move = (type, x, y, time) => {
    track.push([
      type, Math.round(x - previousX), Math.round(y - previousY),
      Math.round(time - previousTime), 0,
    ]);
    previousX = x;
    previousY = y;
    previousTime = time;
  };

  for (let i = 0, count = 8 + Math.floor(Math.random() * 7); i < count; i++) {
    move(1, previousX + (Math.random() - 0.5) * 14, previousY + (Math.random() - 0.5) * 10,
      previousTime + 120 + Math.random() * 260);
  }

  const count = 62 + Math.floor(Math.random() * 7);
  const targetX = 622 + (Math.random() - 0.5) * 6;
  const targetY = 418 + (Math.random() - 0.5) * 5;
  const startX = previousX;
  const startY = previousY;
  for (let i = 0; i < count; i++) {
    const progress = (i + 1) / count;
    const ease = 1 - Math.pow(1 - progress, 2.2);
    move(1,
      startX + (targetX - startX) * ease + (Math.random() - 0.5) * 3.5,
      startY + (targetY - startY) * ease + (Math.random() - 0.5) * 3,
      previousTime + 31 + Math.random() * 17 + (Math.random() < 0.08 ? 40 + Math.random() * 50 : 0));
  }

  for (let i = 0, count = 2 + Math.floor(Math.random() * 4); i < count; i++) {
    move(1, previousX + (Math.random() - 0.5) * 4, previousY + (Math.random() - 0.5) * 3,
      previousTime + 45 + Math.random() * 90);
  }
  track.push([2, Math.round((Math.random() - 0.5) * 2), Math.round((Math.random() - 0.5) * 2), Math.round(130 + Math.random() * 220), 0]);
  track.push([3, 0, 0, 65 + Math.round(Math.random() * 85), 0]);
  return track;
}

(async () => {
  const { cookies } = await solveLayer1();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'eo_chrome_'));
  log(`[验证码组件] 正在以无头模式启动 ${path.basename(CHROME)}。`);
  const browser = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=0', '--disable-blink-features=AutomationControlled',
    `--user-data-dir=${profile}`, '--window-size=1366,960', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  let cdp;
  try {
    const wsUrl = await waitForDevTools(browser);
    cdp = new CDP(wsUrl);
    await cdp.connect();
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Network.enable', {}, sessionId);
    await cdp.send('Page.enable', {}, sessionId);

    for (const [name, value] of Object.entries(cookies)) {
      await cdp.send('Network.setCookie', { name, value, domain: SITE_HOSTNAME, path: '/' }, sessionId);
    }

    let sessionInfo = null;
    cdp.on(async message => {
      if (message.method === 'Network.responseReceived' && message.params.response.url.includes('cap_union_prehandle')) {
        try {
          const body = await cdp.send('Network.getResponseBody', { requestId: message.params.requestId }, sessionId);
          const text = body.base64Encoded ? Buffer.from(body.body, 'base64').toString() : body.body;
          const match = text.match(/\((\{[\s\S]*)\)\s*$/);
          if (match) {
            const data = JSON.parse(match[1]);
            const requestUrl = new URL(message.params.response.url);
            const deviceId = requestUrl.searchParams.get('deviceID')
              || requestUrl.searchParams.get('deviceId')
              || data.deviceID
              || data.deviceId
              || data.data?.deviceID
              || data.data?.deviceId
              || '';
            sessionInfo = {
              sess: data.sess,
              powConfig: data.data?.comm_captcha_cfg?.pow_cfg,
              deviceId,
            };
          }
        } catch (_) {}
      }
    });

    await cdp.send('Page.navigate', { url: SITE }, sessionId);
    log('[验证码组件] 正在等待组件会话和 iframe 目标。');
    const started = Date.now();
    let captchaSession = null;
    while (Date.now() - started < 25000) {
      if (sessionInfo) {
        const { targetInfos } = await cdp.send('Target.getTargets');
        const captcha = targetInfos.find(target =>
          target.type === 'iframe' && (target.url.includes('gcaptcha') || target.url.includes('captcha')));
        if (captcha) {
          const attached = await cdp.send('Target.attachToTarget', { targetId: captcha.targetId, flatten: true });
          captchaSession = attached.sessionId;
          break;
        }
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!sessionInfo) throw new Error('未捕获到验证码组件会话。');
    if (!sessionInfo.deviceId) throw new Error('验证码组件的 prehandle 请求中未提供 deviceID。');
    if (!captchaSession) throw new Error('未找到验证码 iframe 目标。');
    log(`[验证码组件] 会话已就绪：${sessionInfo.sess.slice(0, 30)}... deviceID=${sessionInfo.deviceId}`);

    let tdcReady = false;
    for (let i = 0; i < 30; i++) {
      const result = await cdp.send('Runtime.evaluate', {
        expression: "window.TDC && typeof window.TDC.setData === 'function'", returnByValue: true,
      }, captchaSession);
      if (result.result?.value === true) {
        tdcReady = true;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!tdcReady) throw new Error('TDC 未在限定时间内就绪。');
    log('[TDC] 验证码组件的 TDC 实例已就绪。');

    const track = generateTrack();
    await cdp.send('Runtime.evaluate', {
      expression: `
        window.TDC.setData({isNewEntry: 0});
        window.TDC.setData({slideValue: ${JSON.stringify(track)}, verifyBtnPos: [0,0,0,0], opAreaPos: [24,44,244,86], clientSize: [1366,900]});
      `,
    }, captchaSession);
    log(`[TDC] 已提供 ${track.length} 个指针采样点。`);
    await new Promise(resolve => setTimeout(resolve, 500));

    const collect = (await cdp.send('Runtime.evaluate', {
      expression: 'decodeURIComponent(window.TDC.getData(true))', returnByValue: true,
    }, captchaSession)).result.value;
    const info = (await cdp.send('Runtime.evaluate', {
      expression: 'window.TDC.getInfo()', returnByValue: true,
    }, captchaSession)).result.value;
    const eks = info?.info || '';
    if (!collect || collect.startsWith('Err')) throw new Error(`TDC 数据无效：${String(collect).slice(0, 60)}`);
    log(`[TDC] collect 长度：${collect.length} 个字符；eks 长度：${eks.length} 个字符。`);

    const fields = {
      collect,
      tlg: String(collect.length),
      eks,
      sess: sessionInfo.sess,
      ans: JSON.stringify([{ elem_id: 0, type: 'DynAnswerType_TIME', data: '' }]),
      deviceID: sessionInfo.deviceId,
    };
    if (sessionInfo.powConfig) {
      const config = sessionInfo.powConfig;
      const startedAt = Date.now();
      let nonce = 0;
      while (crypto.createHash('md5').update(config.prefix + nonce).digest('hex') !== config.md5) {
        nonce++;
        if (nonce > 5e6) throw new Error('PoW 求解超时。');
      }
      fields.pow_answer = config.prefix + nonce;
      fields.pow_calc_time = String(Math.max(1, Date.now() - startedAt));
      log(`[PoW] 求解完成，nonce=${nonce}。`);
    }

    const requestBody = Object.entries(fields)
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join('&');
    const verification = await fetch(`${EO}/cap_union_new_verify`, {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Referer: SITE },
      body: requestBody,
    });
    const result = JSON.parse(await verification.text());
    log(`[验证] errorCode=${result.errorCode}`);
    if (result.errorCode !== '0') {
      log(`[失败] ${JSON.stringify(result).slice(0, 200)}`);
      process.exitCode = 1;
      return;
    }
    log(`[通过] ticket=${result.ticket.slice(0, 50)}... randstr=${result.randstr}`);
    fs.appendFileSync(path.join(__dirname, 'eo_tickets.txt'), `${result.ticket}\n`);

    await cdp.send('Network.setCookie', {
      name: 'EO-Bot-Captcha-Token', value: result.ticket, domain: TOKEN_DOMAIN, path: '/',
    }, sessionId);
    await cdp.send('Page.navigate', { url: SITE }, sessionId);
    await new Promise(resolve => setTimeout(resolve, 4000));
    const browserResponse = await cdp.send('Runtime.evaluate', {
      expression: 'document.documentElement.outerHTML', returnByValue: true,
    }, sessionId);
    const browserHtml = browserResponse.result?.value || '';
    const browserPassed = !browserHtml.includes('__tst_status')
      && !browserHtml.includes('TEOCaptchaWidget')
      && !browserHtml.includes('Security Verification');
    log(`[浏览器检查] ${browserPassed ? '通过，未再返回验证页面。' : '仍显示验证页面。'}`);

    const cookieParts = Object.entries(cookies).map(([key, value]) => `${key}=${value}`);
    cookieParts.push(`EO-Bot-Captcha-Token=${result.ticket}`);
    const protocolResponse = await fetch(SITE, {
      headers: { 'User-Agent': UA, Cookie: cookieParts.join('; ') }, redirect: 'manual',
    });
    const protocolHtml = await protocolResponse.text();
    const protocolPassed = !protocolHtml.includes('__tst_status')
      && !protocolHtml.includes('TEOCaptchaWidget')
      && !protocolHtml.includes('Security Verification');
    if (!browserPassed && !protocolPassed) process.exitCode = 1;
  } finally {
    if (cdp) cdp.close();
    browser.kill();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
  }
})().catch(error => {
  console.error(`[错误] ${error.message}`);
  process.exit(1);
});
