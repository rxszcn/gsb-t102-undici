/**
 * 同一条 HTTP 日期串，在库里三处读法上给出的读数对照。
 *
 * 跑法（undici 工作副本根目录）：node repro/http-date-panel.mjs
 *   不需要 build / 编译：`npm run build:node` 只服务 test/fetch、test/eventsource，
 *   这里只用 index.js 与 lib/ 下的现成码；前提是 `npm ci` 已把依赖装好。
 * 判读：每行一格，PASS/FAIL + 这格归谁管 + 实际读数；最后一行 TOTAL x/N。
 *
 * 每格自己造输入：日期串都按当前时刻现推，服务器用临时端口 listen(0) 用完即关，
 * 不落盘、不留全局状态，可以反复跑。
 */
import http from 'node:http'
import undici from '../index.js'
import dateMod from '../lib/util/date.js'
import cookieParseMod from '../lib/web/cookies/parse.js'

const { Pool, interceptors, getSetCookies, Headers } = undici
const parseHttpDate = (dateMod || {}).parseHttpDate
const parseSetCookie = (cookieParseMod || {}).parseSetCookie

let pass = 0
let fail = 0
function cell (name, owner, ok, detail) {
  if (ok) { pass++; console.log('PASS', name, '|', owner, '|', detail) } else { fail++; console.log('FAIL', name, '|', owner, '|', detail) }
}
// 一格出事不能带停整块面板
function probe (fn) {
  try { return ['ok', fn()] } catch (e) { return ['exc', (e && e.constructor ? e.constructor.name : 'Error') + ': ' + String(e && e.message).slice(0, 60)] }
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const p2 = (n, pad = '0') => String(n).padStart(2, pad)
const clock = (d) => p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()) + ':' + p2(d.getUTCSeconds())

// IMF-fixdate：Sun, 06 Nov 2026 08:49:37 GMT
function imf (d) { return `${DOW[d.getUTCDay()]}, ${p2(d.getUTCDate())} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()} ${clock(d)} GMT` }
// obs-date（RFC 850 拼法，两位年 + 缩写星期）：Sun, 06-Nov-94 08:49:37 GMT
function obs (d) { return `${DOW[d.getUTCDay()]}, ${p2(d.getUTCDate())}-${MON[d.getUTCMonth()]}-${p2(d.getUTCFullYear() % 100)} ${clock(d)} GMT` }
// obs-date 全名星期：Sunday, 06-Nov-94 08:49:37 GMT
function obsFull (d) { const full = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']; return `${full[d.getUTCDay()]}, ${p2(d.getUTCDate())}-${MON[d.getUTCMonth()]}-${p2(d.getUTCFullYear() % 100)} ${clock(d)} GMT` }
// ANSI C asctime()：Sun Nov  6 08:49:37 1994
function asc (d) { return `${DOW[d.getUTCDay()]} ${MON[d.getUTCMonth()]} ${p2(d.getUTCDate(), ' ')} ${clock(d)} ${d.getUTCFullYear()}` }
// 同一时刻、时区写成 UTC
function utcZone (d) { return imf(d).replace(/GMT$/, 'UTC') }

const IMF_1994 = 'Sun, 06 Nov 1994 08:49:37 GMT'
const WANT_1994 = Date.UTC(1994, 10, 6, 8, 49, 37)
const OBS_1994 = 'Sun, 06-Nov-94 08:49:37 GMT'
const ASCTIME_1994 = 'Sun Nov  6 08:49:37 1994'
const NOEXIST = 'Tue, 29 Feb 2023 08:49:37 GMT' // 2023 年 2 月没有 29 日
const strict = (s) => String((probe(() => parseHttpDate(s)))[1])
const strictMs = (s) => { const r = probe(() => parseHttpDate(s))[1]; return r === undefined || r === null ? 'undefined' : String(Number(r)) }
const v8ms = (s) => String(new Date(s).getTime())

// ---- 库内日期工具自己的语法人：D 组（owner: lib/util/date.js）
const strictKind = typeof parseHttpDate
cell('D0 parseHttpDate 仍是一个可调用的人', 'lib/util/date.js', strictKind === 'function', 'typeof=' + strictKind)
cell('D1 缩写星期 + 破折号拼法（obs-date）给出这一刻', 'lib/util/date.js', strictMs(OBS_1994) === String(WANT_1994), `strict=${strictMs(OBS_1994)} want=${WANT_1994} Date.parse=${v8ms(OBS_1994)}`)
cell('D2 全名星期 + 破折号拼法给出这一刻（对照）', 'lib/util/date.js', strictMs(obsFull(new Date(WANT_1994))) === String(WANT_1994), `strict=${strictMs(obsFull(new Date(WANT_1994)))} want=${WANT_1994}`)
cell('D3 IMF 拼法给出这一刻（对照）', 'lib/util/date.js', strictMs(IMF_1994) === String(WANT_1994), `strict=${strictMs(IMF_1994)}`)
cell('D4 asctime 拼法按 GMT 读，不跟本地时区跑', 'lib/util/date.js', strictMs(ASCTIME_1994) === String(WANT_1994), `strict=${strictMs(ASCTIME_1994)} Date.parse(本地读)=${v8ms(ASCTIME_1994)} 本机时区偏移=${new Date().getTimezoneOffset()}min`)
cell('D5 不存在的日历日不给数', 'lib/util/date.js', strictMs(NOEXIST) === 'undefined', `strict=${strictMs(NOEXIST)} Date.parse=${v8ms(NOEXIST)}`)
cell('D6 时区写成 UTC 不给数（GMT 才算 HTTP-date）', 'lib/util/date.js', strictMs(utcZone(new Date(WANT_1994))) === 'undefined', `strict=${strictMs(utcZone(new Date(WANT_1994)))} Date.parse=${v8ms(utcZone(new Date(WANT_1994)))}`)

// ---- cookie 那侧的 Expires：C 组（owner: lib/web/cookies/parse.js）
function cookieExp (v) {
  const r = probe(() => {
    const c = parseSetCookie('a=1; Expires=' + v)
    if (c === null) return 'rejected'
    return c.expires === undefined ? 'session' : String(c.expires.getTime())
  })
  if (r[0] === 'exc') return 'threw ' + r[1]
  return String(r[1])
}
function pubCookieExp (v) {
  const r = probe(() => {
    const headers = new Headers({ 'set-cookie': 'a=1; Expires=' + v })
    const cs = getSetCookies(headers)
    return cs.length === 0 ? 'none' : (cs[0].expires === undefined ? 'session' : String(cs[0].expires.getTime()))
  })
  return r[0] === 'exc' ? 'threw ' + r[1] : String(r[1])
}
// cookie 念不出时刻（session/rejected/none）与日期工具给 undefined 视为同一口径
function sameVerdict (cookieVal, strictVal) {
  const cookieDropped = cookieVal === 'session' || cookieVal === 'rejected' || cookieVal === 'none'
  return cookieDropped ? strictVal === 'undefined' : cookieVal === strictVal
}
cell('C1 cookie 的 Expires 与日期工具给同一个数（obs-date）', 'lib/web/cookies/parse.js + lib/util/date.js', cookieExp(OBS_1994) === String(WANT_1994) && sameVerdict(cookieExp(OBS_1994), strictMs(OBS_1994)), `cookie=${cookieExp(OBS_1994)} strict=${strictMs(OBS_1994)} want=${WANT_1994}`)
cell('C2 cookie 不认不存在的日历日', 'lib/web/cookies/parse.js', ['session', 'rejected', 'none'].includes(cookieExp(NOEXIST)), `cookie=${cookieExp(NOEXIST)} (Date.parse 把它挪成 ${v8ms(NOEXIST)})`)
cell('C3 cookie 的 asctime 与日期工具同读数', 'lib/web/cookies/parse.js + lib/util/date.js', cookieExp(ASCTIME_1994) === strictMs(ASCTIME_1994) && cookieExp(ASCTIME_1994) === String(WANT_1994), `cookie=${cookieExp(ASCTIME_1994)} strict=${strictMs(ASCTIME_1994)} Date.parse=${v8ms(ASCTIME_1994)}`)
cell('C4 cookie 对 UTC 拼法与日期工具同口径', 'lib/web/cookies/parse.js + lib/util/date.js', sameVerdict(cookieExp(utcZone(new Date(WANT_1994))), strictMs(utcZone(new Date(WANT_1994)))), `cookie=${cookieExp(utcZone(new Date(WANT_1994)))} strict=${strictMs(utcZone(new Date(WANT_1994)))}`)
cell('C5 走公共入口的 cookie 也给这一刻（对照）', 'lib/web/cookies/parse.js + index.js', pubCookieExp('Fri, 07 Jan 1983 15:32:00 GMT') === String(Date.UTC(1983, 0, 7, 15, 32)), `public=${pubCookieExp('Fri, 07 Jan 1983 15:32:00 GMT')} want=${Date.UTC(1983, 0, 7, 15, 32)}`)
cell('C6 cookie 念不通的 Expires 留作会话 cookie（对照）', 'lib/web/cookies/parse.js', cookieExp('not-a-date') === 'session', `cookie=${cookieExp('not-a-date')}`)

// ---- Retry-After 那侧：R 组（owner: lib/handler/retry-handler.js）
async function retryWait (retryAfterValue, { minTimeout = 150, maxTimeout = 8000 } = {}) {
  let seen = 0
  const srv = http.createServer((req, res) => {
    seen++
    if (seen === 1) {
      res.writeHead(503, { 'retry-after': String(retryAfterValue), 'content-length': '0' })
      res.end()
    } else {
      res.writeHead(200, { 'content-length': '2' })
      res.end('ok')
    }
  })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const port = srv.address().port
  const pool = new Pool(`http://127.0.0.1:${port}`).compose(interceptors.retry({
    maxRetries: 1, minTimeout, maxTimeout, jitter: 0, retryAfter: true
  }))
  const t0 = Date.now()
  let err = ''
  try {
    const r = await pool.request({ path: '/p' + seen + Math.random().toString(36).slice(2), method: 'GET' })
    await r.body.text()
  } catch (e) { err = ' threw:' + String(e && e.message).slice(0, 40) }
  const ms = Date.now() - t0
  await pool.close().catch(() => {})
  await new Promise((r) => srv.close(r))
  return { ms, err }
}

const wait = async (s, opt) => (await probeAsync(async () => retryWait(s, opt)))[1]

function probeAsync (fn) {
  return fn().then((v) => ['ok', v]).catch((e) => ['exc', { ms: -1, err: 'threw:' + String(e && e.message).slice(0, 50) }])
}

async function main () {
  const future = () => new Date(Date.now() + 2000)
  const a1 = await wait(asc(future()))
  cell('R1 asctime 拼法的 Retry-After 真等到那一刻', 'lib/handler/retry-handler.js', a1.ms >= 1500 && a1.ms < 3500, `delay=${a1.ms}ms${a1.err} Date.parse 读成${new Date(asc(future())).getTime() - Date.now()}ms 之后`)
  const a2 = await wait(imf(future()))
  cell('R2 IMF 拼法的 Retry-After 真等到那一刻（对照）', 'lib/handler/retry-handler.js', a2.ms >= 1000 && a2.ms < 3500, `delay=${a2.ms}ms${a2.err}`)
  const a3 = await wait(obs(future()))
  cell('R3 obs-date 拼法的 Retry-After 与日期工具同口径', 'lib/handler/retry-handler.js + lib/util/date.js', (strictMs(obs(new Date(WANT_1994))) === 'undefined' && a3.ms >= 100 && a3.ms < 1500) || (strictMs(obs(new Date(WANT_1994))) !== 'undefined' && a3.ms >= 1500 && a3.ms < 3500), `delay=${a3.ms}ms${a3.err} strict(obs-date)=${strictMs(OBS_1994)}`)
  const u = await wait(utcZone(future()))
  cell('R4 UTC 拼法的 Retry-After 与日期工具同口径', 'lib/handler/retry-handler.js + lib/util/date.js', (strictMs(utcZone(new Date(WANT_1994))) === 'undefined' && u.ms >= 100 && u.ms < 1500) || (strictMs(utcZone(new Date(WANT_1994))) !== 'undefined' && u.ms >= 1500 && u.ms < 3500), `delay=${u.ms}ms${u.err} strict(UTC 拼法)=${strictMs(utcZone(new Date(WANT_1994)))}`)
  const g = await wait('this is not a date')
  cell('R5 念不通的 Retry-After 落回逐次加长的退避', 'lib/handler/retry-handler.js', g.ms >= 100 && g.ms < 1500, `delay=${g.ms}ms${g.err}`)
  const c = await wait('999999')
  cell('R6 超出 maxTimeout 的时刻被夹住（对照）', 'lib/handler/retry-handler.js', c.ms >= 7500 && c.ms < 12000, `delay=${c.ms}ms${c.err}`)
  console.log('TOTAL', pass + '/' + (pass + fail))
}
main().catch((e) => { console.log('FATAL', e && e.message); console.log('TOTAL', pass + '/' + (pass + fail)) })
