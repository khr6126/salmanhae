import './style.css'
import { mountMapHome } from './map-home.js'
import { DEMO_MODE, COMMUTE_DAYS, getCommuteData, calculateCommute } from './commute-api.js'

document.querySelector('#app').innerHTML = `
  <header class="header">
    <a class="brand" href="#">살만해<span>.</span></a>
    <span class="header-label">나에게 맞는 주거비 찾기</span>
  </header>

  <main>
    <section class="intro">
      <div class="intro-text">
        <span class="badge">교통부터 주거까지, 한 번에 비교</span>

        <h1>
          월세는 싸지만,<br>
          정말 <span>살 만할까?</span>
        </h1>

        <p class="description">
          보증금과 월세에 교통비, 출퇴근 시간까지 더해보세요.<br>
          내 생활을 기준으로 계산한 ‘진짜 월세’를 알려드려요.
        </p>

        <p class="notice">
          과거 실거래가를 바탕으로 동네 시세를 비교하는 서비스입니다.
        </p>
      </div>

      <aside class="cost-card" aria-label="진짜 월세 계산 예시">
        <div class="card-heading">
          <h2>월세만 보면 놓치는 비용</h2>
          <span class="example-label">계산 예시</span>
        </div>

        <dl class="cost-list">
          <div>
            <dt>월세</dt>
            <dd>500,000원</dd>
          </div>
          <div>
            <dt>보증금 기회비용</dt>
            <dd>25,000원</dd>
          </div>
          <div>
            <dt>관리비 <small>추정</small></dt>
            <dd>50,000원</dd>
          </div>
          <div>
            <dt>월 교통비</dt>
            <dd>60,000원</dd>
          </div>
          <div>
            <dt>월 통근 시간 비용</dt>
            <dd>220,000원</dd>
          </div>
        </dl>

        <div class="total">
          <span>진짜 월세</span>
          <strong>855,000<span>원 / 월</span></strong>
        </div>

        <p class="card-note">
          이해를 돕기 위한 가상 예시입니다.<br>
          시간 비용은 실제 지출이 아닌 시간의 환산 가치입니다.
        </p>
      </aside>
    </section>

    <section class="how-it-works" id="how-it-works">
      <p class="section-label">HOW IT WORKS</p>
      <h2>내 생활에 맞춰, 세 단계로</h2>

      <div class="steps">
        <article class="step">
          <span class="step-number">01</span>
          <h3>내 이동 경로 입력</h3>
          <p>본가와 학교 또는 직장 주소로 현재 통근 부담을 알아봐요.</p>
        </article>

        <article class="step">
          <span class="step-number">02</span>
          <h3>현재 통근 비용 확인</h3>
          <p>교통비와 시간 비용을 더해 현재 통근 부담을 알아봐요.</p>
        </article>

        <article class="step">
          <span class="step-number">03</span>
          <h3>진짜 월세 비교</h3>
          <p>동네별 거래 이력을 총비용 기준으로 살펴봐요.</p>
        </article>
      </div>
      <a class="primary-button intro-bottom-button" href="#start">내 통근 비용 확인하러 가기 →</a>
    </section>
  </main>

  <footer class="footer">
    살만해 · 현재 계약 가능한 매물 정보가 아닌 실거래가 기반 비교 도구
  </footer>
`
const app = document.querySelector('#app')
const introHTML = app.innerHTML
const defaults = { home: '', destination: '', transport: 'public' }
let state = { ...defaults }
let mapCleanup = null
let currentRequest = null
let generation = 0
try {
  const saved = JSON.parse(sessionStorage.getItem('salmanhae-flow-v2') || 'null')
  for (const key of Object.keys(defaults)) {
    if (typeof saved?.[key] === 'string') state[key] = saved[key]
  }
} catch {}
if (!['public', 'car'].includes(state.transport)) state.transport = 'public'


const format = (value) => value.toLocaleString('ko-KR', { maximumFractionDigits: 1 })
const won = (value) => `${format(value)}원`
function save() {
  try { sessionStorage.setItem('salmanhae-flow-v2', JSON.stringify(state)); return true }
  catch { return false }
}
function cancelRequest() {
  mapCleanup?.()
  mapCleanup = null
  generation++
  currentRequest?.abort()
  currentRequest = null
}
function frame(step, title, content, backLabel, back) {
  cancelRequest()
  app.innerHTML = `
    <header class="header">
      <a href="#" class="brand" id="brand-home">살만해<span>.</span></a>
      <span class="header-label">나에게 맞는 주거비 찾기</span>
    </header>
    <main class="address-page">
      <button class="back-button" id="back" type="button">← ${backLabel}</button>
      <section class="address-panel" aria-labelledby="page-title">
        <span class="badge">${step}</span>
        <h1 id="page-title" tabindex="-1">${title}</h1>
        ${content}
        <p class="notice">입력값은 현재 브라우저 탭에 임시 보관됩니다.</p>
      </section>
    </main>`
  document.querySelector('#back').onclick = back
  document.querySelector('#brand-home').onclick = (event) => { event.preventDefault(); showIntro() }
  window.scrollTo(0, 0)
  document.querySelector('#page-title').focus()
}
function connectIntro() {
  for (const button of app.querySelectorAll('.primary-button')) {
    button.onclick = (event) => { event.preventDefault(); showAddress() }
  }
}
function showIntro() {
  cancelRequest()
  app.innerHTML = introHTML
  connectIntro()
  window.scrollTo(0, 0)
  app.querySelector('.primary-button').focus()
}
function bindForm(id) {
  const form = document.getElementById(id)
  for (const input of form.querySelectorAll('[name]')) {
    if (input.type === 'radio') input.checked = input.value === state[input.name]
    else input.value = state[input.name]
    input.addEventListener('input', () => {
      input.setCustomValidity('')
      if (input.type === 'radio' && !input.checked) return
      state[input.name] = input.value
      save()
    })
  }
  return form
}
function showAddress() {
  frame('STEP 01 · 기존 통근 경로', '하루의 시작과 끝,<br>어디를 오가나요?', `
    <form id="address-form">
      <div class="field">
        <label for="home-address">본가 주소</label>
        <input id="home-address" name="home" maxlength="200" placeholder="도로명과 건물번호 입력" required>
      </div>
      <div class="field">
        <label for="destination-address">학교 또는 직장 주소</label>
        <input id="destination-address" name="destination" maxlength="200" placeholder="도로명과 건물번호 입력" required>
      </div>
      <fieldset class="choice-field">
        <legend>현재 통학·통근 방법</legend>
        <div class="choice-grid">
          <label class="choice-option"><input type="radio" name="transport" value="public" required> 대중교통</label>
          <label class="choice-option"><input type="radio" name="transport" value="car"> 자차</label>
        </div>
      </fieldset>
      <p class="input-help">월 통학·출근일수는 20일로 계산합니다.</p>
      ${DEMO_MODE ? '<p class="demo-notice">데모 모드: 다음 화면은 입력 주소를 실제 조회하지 않고 예시 경로·요금·유가로 계산합니다.</p>' : ''}
      <button class="primary-button form-submit" type="submit">내 통근 비용 확인하기 →</button>
    </form>`, '서비스 소개', showIntro)
  const form = bindForm('address-form')
  form.onsubmit = (event) => {
    event.preventDefault()
    for (const input of form.querySelectorAll('input:not([type="radio"])')) {
      if (!input.value.trim()) {
        input.setCustomValidity('공백만 입력할 수 없어요. 주소를 입력해주세요.')
        input.reportValidity()
        return
      }
      state[input.name] = input.value.trim()
    }
    save()
    showCommute()
  }
}
async function showCommute() {
  const request = { homeAddress: state.home, destinationAddress: state.destination, transport: state.transport, year: 2026 }
  frame('STEP 02 · 현재 통근 부담', '길 위에서 쓰는 돈과 시간,<br>한 달이면 얼마일까요?', `
    <div class="destination-summary"><span id="mode"></span><strong id="route"></strong></div>
    <div id="loading" role="status">경로와 비용 기준을 확인하고 있어요…</div>
    <div id="error" role="alert" hidden><p id="error-text"></p><button class="primary-button" id="retry" type="button">다시 시도</button></div>
    <section id="result" class="commute-result" hidden>
      <p id="data-notice" class="demo-notice" hidden></p>
      <p>매달 통근에 드는 지출과 시간의 가치</p>
      <h2 id="total"></h2>
      <dl class="cost-list">
        <div><dt id="travel-label"></dt><dd id="travel-cost"></dd></div>
        <div><dt>월 시간 기회비용</dt><dd id="time-cost"></dd></div>
      </dl>
      <div class="calculation-details"><p id="travel-formula"></p><p id="time-formula"></p><p id="basis"></p></div>
      <p>이 시간을 나를 위해 쓸 수 있다면?<br>자취할 때의 진짜 월세와 비교해보세요.</p>
      <button class="primary-button form-submit" type="button" id="continue">자취방 찾으러 갑시다 →</button>
      <p class="input-help">합계는 실제 교통 지출과 시간의 환산 가치를 더한 추정치입니다. 전액이 현금 지출이거나 이사 후 절약되는 것은 아닙니다.</p>
    </section>`, '주소·이동수단 수정', showAddress)
  document.querySelector('#mode').textContent = `${state.transport === 'public' ? '대중교통' : '자차'} · 월 ${COMMUTE_DAYS}일 기준`
  document.querySelector('#route').textContent = `${state.home} ↔ ${state.destination}`
  document.querySelector('#retry').onclick = showCommute
  const token = generation
  currentRequest = new AbortController()
  const controller = currentRequest
  const timeout = setTimeout(() => controller.abort(), 15000)
  try {
    const data = await getCommuteData(request, controller.signal)
    if (generation !== token) return
    const cost = calculateCommute(data, request.transport, request.year)
    document.querySelector('#total').textContent = `${won(cost.total)} / 월`
    document.querySelector('#travel-label').textContent = request.transport === 'public' ? '월 대중교통비' : '월 기름값'
    document.querySelector('#travel-cost').textContent = won(cost.monthlyTravel)
    document.querySelector('#time-cost').textContent = won(cost.monthlyTime)
    document.querySelector('#time-formula').textContent = `시간 비용: 왕복 ${format(cost.minutes)}분 ÷ 60 × 20일 × 시급 ${won(cost.wage)} = ${won(cost.monthlyTime)}`
    if (request.transport === 'public') {
      document.querySelector('#travel-formula').textContent = `교통비: (가는 요금 ${won(data.route.outboundFareWon)} + 오는 요금 ${won(data.route.returnFareWon)}) × 20일 = ${won(cost.monthlyTravel)}`
      document.querySelector('#basis').textContent = `${data.minimumWage.year}년 최저시급 기준 · 왕복 시간을 합산합니다. 정기권·개인별 할인은 반영하지 않은 기준 요금입니다.`
    } else {
      document.querySelector('#travel-formula').textContent = `기름값: 왕복 ${format(cost.km)}km ÷ 평균 연비 ${format(data.car.averageKmPerLiter)}km/L × 유가 ${won(data.car.fuelWonPerLiter)}/L × 20일 = ${won(cost.monthlyTravel)}`
      document.querySelector('#basis').textContent = `${data.minimumWage.year}년 최저시급 기준 · ${data.car.fuelType || '연료 종류 미제공'} · 유가 기준일: ${data.car.priceDate || '미제공'}. 기름값 외 주차비·통행료·차량 유지비는 제외합니다.`
    }
    if (data.demo) {
      const notice = document.querySelector('#data-notice')
      notice.hidden = false
      notice.textContent = '데모 계산 예시 — 입력 주소에 대한 실제 조회 결과가 아닙니다. 경로·요금·연비·유가는 임시 응답입니다.'
    }
    document.querySelector('#continue').onclick = () => showMapHome(cost, data.demo)
    document.querySelector('#result').hidden = false
  } catch (error) {
    if (generation !== token) return
    document.querySelector('#error-text').textContent = error.name === 'AbortError' ? '조회 시간이 초과됐어요. 다시 시도해주세요.' : error.message
    document.querySelector('#error').hidden = false
  } finally {
    clearTimeout(timeout)
    if (generation === token) document.querySelector('#loading').hidden = true
  }
}

function showMapHome(cost, demo) {
  cancelRequest()
  mapCleanup = mountMapHome(app, {
    baseline: cost.total, wage: cost.wage, demo,
    destination: state.destination, back: showCommute, intro: showIntro,
  })
}
connectIntro()

