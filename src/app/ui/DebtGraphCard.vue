<script setup lang="ts">
import { computed } from 'vue'
import type { Participant, TripState } from '../../core'
import { computeBalances, settle } from '../../core'
import { formatMinor } from './format'

// Карточка «Граф долгов» (глоссарий): визуализация седения — те же данные, что
// в SettlementCard, круговой раскладкой. Денежная логика — только операции
// ядра (computeBalances → settle); всё остальное здесь — геометрия показа:
// углы, координаты дуг, обрезка имён и склонение для подписи направления.
// Чистый SVG, анимации — только Vue-переходы (никаких d3-force и canvas).

const props = defineProps<{
  /** Весь стейт поездки: граф — производная от расходов, выплат и курсов. */
  trip: TripState
}>()

// Холст и кольцо участников: подписи уходят наружу кольца, поэтому viewBox
// шире высоты; карточка max-w-md, svg — w-full и масштабируется viewBox-ом.
const VIEW_W = 480
const VIEW_H = 420
const CX = VIEW_W / 2
const CY = VIEW_H / 2
const RING = 118

// Стрелка перевода: длина и полуширина треугольника у кредитора.
const ARROW_LEN = 9
const ARROW_WIDTH = 8
// Прогиб дуги к центру: 0 — хорда, 1 — через центр.
const BEND = 0.35

type Tone = 'credit' | 'debt' | 'zero'

// Те же тона, что в SettlementCard: кредит / долг / ноль.
const toneClass = {
  credit: 'fill-emerald-600 dark:fill-emerald-400',
  debt: 'fill-red-600 dark:fill-red-400',
  zero: 'fill-zinc-500 dark:fill-zinc-400',
} as const

function toneOf(amount: number): Tone {
  return amount > 0 ? 'credit' : amount < 0 ? 'debt' : 'zero'
}

/** Дательный падеж имени для подписи направления («переводит Ане»): эвристика
 *  по окончанию типовых русских имён; незнакомое окончание остаётся как есть. */
function dative(name: string): string {
  if (name.endsWith('ия')) return `${name.slice(0, -1)}и`
  if (/[ая]$/.test(name)) return `${name.slice(0, -1)}е`
  if (/[йь]$/.test(name)) return `${name.slice(0, -1)}ю`
  if (/[бвгджзклмнпрстфхцчшщ]$/.test(name)) return `${name}у`
  return name
}

/** Обрезка длинных имён с многоточием — геометрия показа, данные не меняются. */
function truncate(name: string, maxChars: number): string {
  return name.length > maxChars ? `${name.slice(0, Math.max(1, maxChars - 1))}…` : name
}

/** Точка на расстоянии dist от (x, y) в сторону цели (tx, ty). */
function toward(x: number, y: number, tx: number, ty: number, dist: number) {
  const dx = tx - x
  const dy = ty - y
  const len = Math.hypot(dx, dy) || 1
  return { x: x + (dx / len) * dist, y: y + (dy / len) * dist }
}

const balances = computed(() => computeBalances(props.trip))
const count = computed(() => props.trip.participants.length)

// Размеры зависят от компании: 20 участников на телефоне — кегль меньше.
const nodeRadius = computed(() => {
  const n = count.value
  if (n <= 4) return 24
  if (n <= 8) return 20
  if (n <= 13) return 17
  return 14
})
const nameFont = computed(() => (count.value <= 8 ? 12 : 10))
const arcStroke = computed(() => (count.value <= 8 ? 2.5 : 2))

interface NodeLabel {
  x: number
  nameY: number
  amountY: number
  anchor: 'start' | 'middle' | 'end'
  maxChars: number
}

/** Нода участника: позиция на кольце и подпись (имя + баланс с тоном). */
interface GraphNode {
  participant: Participant
  tone: Tone
  /** Подпись баланса: «+666,66» / «−333,33» / «в нуле». */
  balanceLabel: string
  name: string
  x: number
  y: number
  label: NodeLabel
}

const nodes = computed<GraphNode[]>(() => {
  const n = count.value
  if (n === 0) return []
  const r = nodeRadius.value
  const font = nameFont.value
  const charW = font * 0.62 // средняя ширина кириллического знака при кегле font
  const sideMax = n <= 8 ? 104 : 66

  // Круговая раскладка по балансу по убыванию: кредиторы стартуют с верхушки,
  // нулевые — между кредиторами и должниками, должники замыкают круг; при
  // равенстве — порядок участников (тай-брейк, как в остальном UI). Крупный
  // кредитор и крупный должник оказываются соседями через стык круга — их
  // перевод (обычно самый большой) — короткая дуга.
  const byId = new Map(props.trip.participants.map((p) => [p.id, p]))
  const ordered = balances.value
    .map((entry, order) => ({
      participant: byId.get(entry.participantId)!, // стыковка по id, как в SettlementCard
      amount: entry.amount,
      order,
    }))
    .sort((a, b) => b.amount - a.amount || a.order - b.order)

  return ordered.map((row, i) => {
    // Один участник — не на кольце, а в центре; иначе старт с 12 часов по часовой.
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n
    const cos = n === 1 ? 0 : Math.cos(angle)
    const sin = n === 1 ? -1 : Math.sin(angle)
    const x = n === 1 ? CX : CX + RING * cos
    const y = n === 1 ? CY : CY + RING * sin

    // Подпись у полюсов — по центру над/под нодой (шаг круга ≥ 18°, в зону
    // |cos| < 0,3 попадает только сам полюсный узел); прочие — сбоку от ноды,
    // соседи расходятся в противоположные стороны и не сталкиваются.
    let label: NodeLabel
    if (Math.abs(cos) < 0.3) {
      const above = sin < 0
      label = {
        x,
        nameY: y + (above ? -r - 12 : r + 20),
        amountY: y + (above ? -r - 26 : r + 34),
        anchor: 'middle',
        maxChars: Math.max(3, Math.floor(130 / charW)),
      }
    } else if (cos > 0) {
      const lx = x + r + 7
      label = {
        x: lx,
        nameY: y - 3,
        amountY: y + 13,
        anchor: 'start',
        maxChars: Math.max(3, Math.floor(Math.min(sideMax, VIEW_W - 12 - lx) / charW)),
      }
    } else {
      const lx = x - r - 7
      label = {
        x: lx,
        nameY: y - 3,
        amountY: y + 13,
        anchor: 'end',
        maxChars: Math.max(3, Math.floor(Math.min(sideMax, lx - 12) / charW)),
      }
    }

    const balanceLabel =
      row.amount > 0
        ? `+${formatMinor(row.amount)}`
        : row.amount < 0
          ? `−${formatMinor(-row.amount)}`
          : 'в нуле'

    return {
      participant: row.participant,
      tone: toneOf(row.amount),
      balanceLabel,
      name: truncate(row.participant.name, label.maxChars),
      x,
      y,
      label,
    }
  })
})

/** Дуга перевода: путь, стрелка у кредитора и подпись суммы у середины. */
interface Arc {
  key: string
  path: string
  arrow: string
  labelX: number
  labelY: number
  labelText: string
  ariaLabel: string
  color: string
}

const arcs = computed<Arc[]>(() => {
  const r = nodeRadius.value
  const byId = new Map(nodes.value.map((node) => [node.participant.id, node]))
  return settle(balances.value).flatMap((transfer) => {
    const from = byId.get(transfer.fromId)
    const to = byId.get(transfer.toId)
    // Упомянутого в расчётах участника удалить нельзя, но чужому референсу
    // просто не рисуем дугу вместо падения — нейтральность, как в SettlementCard.
    if (!from || !to) return []

    // Контрольная точка — середина хорды, притянутая к центру: дуги «обнимают» круг.
    const midX = (from.x + to.x) / 2
    const midY = (from.y + to.y) / 2
    const ctrlX = midX + (CX - midX) * BEND
    const ctrlY = midY + (CY - midY) * BEND

    const start = toward(from.x, from.y, ctrlX, ctrlY, r + 2)
    const tip = toward(to.x, to.y, ctrlX, ctrlY, r + 3)
    const end = toward(to.x, to.y, ctrlX, ctrlY, r + 3 + ARROW_LEN)

    // Касательная квадратичной дуги в конце — направление (конец − контроль):
    // стрелка-треугольник вручную, остриём в кредитора, без marker.
    const dx = to.x - ctrlX
    const dy = to.y - ctrlY
    const len = Math.hypot(dx, dy) || 1
    const ux = dx / len
    const uy = dy / len
    const px = -uy
    const py = ux
    const baseX = tip.x - ux * ARROW_LEN
    const baseY = tip.y - uy * ARROW_LEN
    const half = ARROW_WIDTH / 2
    const f = (v: number) => v.toFixed(1)

    const arc: Arc = {
      key: `${transfer.fromId}:${transfer.toId}`,
      path: `M ${f(start.x)} ${f(start.y)} Q ${f(ctrlX)} ${f(ctrlY)} ${f(end.x)} ${f(end.y)}`,
      arrow: `${f(tip.x)},${f(tip.y)} ${f(baseX + px * half)},${f(baseY + py * half)} ${f(baseX - px * half)},${f(baseY - py * half)}`,
      // Середина квадратичной дуги (t = 0,5), чуть выше линии.
      labelX: 0.25 * start.x + 0.5 * ctrlX + 0.25 * end.x,
      labelY: 0.25 * start.y + 0.5 * ctrlY + 0.25 * end.y - 6,
      labelText: formatMinor(transfer.amount),
      ariaLabel: `${from.participant.name} переводит ${dative(to.participant.name)} ${formatMinor(transfer.amount)} ${props.trip.baseCurrency}`,
      color: to.participant.color,
    }
    return [arc]
  })
})
</script>

<template>
  <section
    class="space-y-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
    aria-labelledby="debt-graph-heading"
  >
    <h2 id="debt-graph-heading" class="font-medium">Граф долгов</h2>

    <p v-if="count === 0" class="text-sm text-zinc-500 dark:text-zinc-400">
      Добавьте участников, чтобы увидеть граф долгов
    </p>

    <template v-else>
      <svg
        :viewBox="`0 0 ${VIEW_W} ${VIEW_H}`"
        role="img"
        aria-label="Граф долгов"
        class="block w-full"
      >
        <!-- Дуги под нодами: стрелка приходит в кредитора, не прячась за подписи. -->
        <TransitionGroup tag="g" name="debt-arc">
          <g v-for="arc in arcs" :key="arc.key" class="debt-arc" :aria-label="arc.ariaLabel">
            <path
              :d="arc.path"
              fill="none"
              :stroke="arc.color"
              :stroke-width="arcStroke"
              stroke-linecap="round"
            />
            <polygon :points="arc.arrow" :fill="arc.color" aria-hidden="true" />
            <text
              :x="arc.labelX.toFixed(1)"
              :y="arc.labelY.toFixed(1)"
              text-anchor="middle"
              font-size="11"
              paint-order="stroke"
              stroke-width="4"
              class="debt-arc-amount fill-zinc-700 font-medium tabular-nums stroke-white dark:fill-zinc-300 dark:stroke-zinc-900"
            >
              {{ arc.labelText }}
            </text>
          </g>
        </TransitionGroup>

        <!-- Нода переезжает CSS-переходом transform при пересортировке круга. -->
        <g
          v-for="node in nodes"
          :key="node.participant.id"
          class="debt-node"
          :style="{
            transform: `translate(${node.x}px, ${node.y}px)`,
            transition: 'transform 0.45s ease',
          }"
        >
          <circle
            :r="nodeRadius"
            :fill="node.participant.color + '33'"
            :stroke="node.participant.color"
            stroke-width="2"
          />
          <text text-anchor="middle" dominant-baseline="central" :font-size="nodeRadius">
            {{ node.participant.emoji }}
          </text>
          <text
            :x="node.label.x - node.x"
            :y="node.label.nameY - node.y"
            :text-anchor="node.label.anchor"
            :font-size="nameFont"
            class="fill-zinc-800 dark:fill-zinc-200"
          >
            {{ node.name }}
          </text>
          <text
            :x="node.label.x - node.x"
            :y="node.label.amountY - node.y"
            :text-anchor="node.label.anchor"
            :font-size="nameFont"
            class="debt-amount font-medium tabular-nums"
            :class="toneClass[node.tone]"
          >
            {{ node.balanceLabel }}
          </text>
        </g>
      </svg>

      <p v-if="arcs.length === 0" class="text-sm text-zinc-500 dark:text-zinc-400">
        Долгов нет — все в нуле
      </p>
    </template>
  </section>
</template>

<style scoped>
/* Дуги: короткое появление и более долгое «затухание» погашенного долга —
   единственные анимации графа (правило: Vue-переходы, без библиотек). */
.debt-arc-enter-active {
  transition: opacity 0.25s ease;
}
.debt-arc-leave-active {
  transition: opacity 0.6s ease;
}
.debt-arc-enter-from,
.debt-arc-leave-to {
  opacity: 0;
}
</style>
