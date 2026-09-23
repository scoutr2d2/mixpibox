#!/usr/bin/env node
// MuPiHAT hardware MOCK.
//
// Writes a synthetic /tmp/mupihat.json on the SAME schema the real
// scripts/mupihat/mupihat.py produces from the BQ25792 charger over I2C, so
// every consumer (backend-api /api/mupihat, the frontend mupihat-icon,
// fan_control.py, mqtt/telegram) can be exercised on an x86 dev machine
// WITHOUT the HAT hardware.  See MODERNIZATION.md §3 (the contract) and §5.
//
// Env:
//   MUPIHAT_OUT        output file        (default /tmp/mupihat.json)
//   MUPIHAT_PERIOD_MS  write interval     (default 5000)
//   MUPIHAT_START_SOC  starting SOC %     (default 87)
//   MUPIHAT_CHARGING   'charge'|'discharge' start direction (default discharge)
//   MUPIHAT_BAT_TYPE   battery label      (default Default)
import { writeFileSync } from 'node:fs'

const OUT = process.env.MUPIHAT_OUT || '/tmp/mupihat.json'
const PERIOD_MS = Number(process.env.MUPIHAT_PERIOD_MS || 5000)
let soc = Number(process.env.MUPIHAT_START_SOC || 87)
let charging = (process.env.MUPIHAT_CHARGING || 'discharge') === 'charge'

const vbatFor = (pct) => +(3.3 + (4.2 - 3.3) * (pct / 100)).toFixed(3)
const statFor = (pct) => (pct <= 5 ? 'SHUTDOWN' : pct <= 15 ? 'LOW' : 'OK')

function tick() {
  // Wander the SOC so consumers see OK -> LOW -> SHUTDOWN and charge cycles.
  soc += charging ? 1.5 : -1.2
  if (soc >= 100) {
    soc = 100
    charging = false
  }
  if (soc <= 3) {
    soc = 3
    charging = true
  }
  const pct = Math.round(soc)
  const state = {
    Charger_Status: charging ? 'Fast Charging' : 'Not Charging',
    Vbat: vbatFor(pct),
    Vbus: charging ? 5.02 : 0.0,
    Ibat: charging ? 0.9 : -0.35,
    IBus: charging ? 1.1 : 0.0,
    Temp: +(31 + Math.sin(Date.now() / 60000) * 3).toFixed(1),
    BatteryConnected: 'true',
    Bat_SOC: `${pct}%`,
    Bat_Stat: statFor(pct),
    Bat_Type: process.env.MUPIHAT_BAT_TYPE || 'Default',
  }
  try {
    writeFileSync(OUT, JSON.stringify(state, null, 2))
  } catch (err) {
    console.error(`[mupihat-mock] write failed: ${err.message}`)
  }
}

tick()
setInterval(tick, PERIOD_MS)
console.log(
  `[mupihat-mock] writing ${OUT} every ${PERIOD_MS}ms (start SOC ${Math.round(soc)}%, ${charging ? 'charging' : 'discharging'})`,
)
