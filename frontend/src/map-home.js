import './map-home.css'

// 실제 실거래가가 아닌 지도·저장 기능 확인용 사례입니다.
const regions = [
  { name: '봉천동', aliases: ['관악구', '봉천', '서울대입구'], center: [37.481, 126.952] },
  { name: '신림동', aliases: ['신림'], center: [37.484, 126.929] },
  { name: '역삼동', aliases: ['강남구', '역삼', '강남'], center: [37.500, 127.036] },
  { name: '마포구', aliases: ['마포', '공덕'], center: [37.545, 126.951] },
]
const homes = [
  { id: 'demo-b1', region: '봉천동', name: '봉천동 비교 사례 A', point: [37.480,126.950], deposit: 10000000, rent: 450000, fee: 50000, travel: 64000, minutes: 60 },
  { id: 'demo-b2', region: '봉천동', name: '봉천동 비교 사례 B', point: [37.484,126.955], deposit: 20000000, rent: 500000, fee: 60000, travel: 60000, minutes: 40 },
  { id: 'demo-s1', region: '신림동', name: '신림동 비교 사례 A', point: [37.483,126.928], deposit: 5000000, rent: 400000, fee: 70000, travel: 64000, minutes: 90 },
  { id: 'demo-y1', region: '역삼동', name: '역삼동 비교 사례 A', point: [37.499,127.034], deposit: 10000000, rent: 750000, fee: 80000, travel: 60000, minutes: 30 },
]
export function homeCost(home, wage) {
  const opportunity = Math.round(home.deposit * 0.03 / 12)
  const time = Math.round(home.minutes / 60 * 20 * wage)
  return { opportunity, time, total: opportunity + home.rent + home.fee + home.travel + time }
}
export function comparisonRows(left, right, wage) {
  const a = homeCost(left, wage), b = homeCost(right, wage)
  return [
    ['보증금', left.deposit, right.deposit, '원'],
    ['월세', left.rent, right.rent, '원'],
    ['추정 관리비 / 월', left.fee, right.fee, '원'],
    ['보증금 기회비용 / 월', a.opportunity, b.opportunity, '원'],
    ['예시 교통비 / 월', left.travel, right.travel, '원'],
    ['예시 왕복 통근시간', left.minutes, right.minutes, '분'],
    ['시간 비용 / 월', a.time, b.time, '원'],
    ['진짜 월세', a.total, b.total, '원'],
  ]
}
const storageKey = 'salmanhae-demo-favorites-v1'
function loadFavorites() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '[]')
    return new Set(Array.isArray(saved) ? saved.filter(id => homes.some(home => home.id === id)) : [])
  } catch { return new Set() }
}
let leafletPromise
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L)
  if (leafletPromise) return leafletPromise
  leafletPromise = new Promise((resolve, reject) => {
    if (!document.querySelector('#leaflet-css')) {
      const css = document.createElement('link')
      css.id = 'leaflet-css'; css.rel = 'stylesheet'
      css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
      css.integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY='
      css.crossOrigin = ''; document.head.append(css)
    }
    const script = document.createElement('script')
    const timer = setTimeout(() => fail(), 15000)
    const fail = () => { clearTimeout(timer); script.remove(); leafletPromise = null; reject(new Error('지도를 불러오지 못했어요. 인터넷 연결을 확인하고 다시 시도해주세요.')) }
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
    script.integrity = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo='
    script.crossOrigin = ''
    script.onload = () => { clearTimeout(timer); resolve(window.L) }
    script.onerror = fail
    document.head.append(script)
  })
  return leafletPromise
}
export function mountMapHome(root, { baseline, wage, demo, destination, back, intro }) {
  const favorites = loadFavorites()
  let selected = regions[0]
  let onlySaved = false
  let view = 'map'
  let needsFit = false
  let map, layer, disposed = false
  const money = value => `${value.toLocaleString('ko-KR')}원`
  root.innerHTML = `
    <header class="header"><button class="brand mh-link" id="mh-intro">살만해<span>.</span></button><span>동네 시세 비교</span></header>
    <main class="mh-page">
      <button class="back-button" id="mh-back">← 통근 비용 다시 보기</button>
      <h1 tabindex="-1" id="mh-title">살고 싶은 동네를 찾아보세요.</h1>
      <div class="mh-baseline"><strong id="mh-baseline"></strong><span id="mh-destination"></span></div>
      <p class="demo-notice">모든 마커·금액·위치는 가상 사례입니다. 실제 실거래가나 계약 가능한 매물이 아닙니다. 예시 통근비는 입력 목적지·이동수단을 반영하지 않습니다.</p>
      <form class="mh-search" id="mh-search"><label for="mh-region">지역 검색</label><input id="mh-region" placeholder="봉천동, 신림동, 역삼동, 마포구" maxlength="100" required><button class="primary-button">검색</button></form>
      <p class="input-help">현재 검색 지원 지역: 봉천동·신림동·역삼동·마포구. 위치 권한을 요청하지 않습니다.</p>
      <div class="mh-toolbar">
        <div class="mh-view-switch" role="group" aria-label="결과 보기 방식">
          <button type="button" id="mh-view-map" aria-pressed="true" aria-controls="mh-map-panel">지도 보기</button>
          <button type="button" id="mh-view-list" aria-pressed="false" aria-controls="mh-list">목록 보기</button>
        </div>
        <button id="mh-saved" aria-pressed="false">☆ 관심만 보기</button><span id="mh-count"></span>
        <button type="button" id="mh-compare" hidden>관심 항목 비교하기</button>
      </div>
      <p role="status" id="mh-status"></p>
      <p id="mh-empty-map" class="mh-empty" hidden></p>
      <div class="mh-layout"><section id="mh-map-panel" aria-label="동네 지도"><div id="mh-map" aria-label="거래 사례 지도"></div><button id="mh-retry" hidden>지도 다시 불러오기</button></section><section class="mh-list" id="mh-list" aria-label="진짜 월세 낮은 순 거래 사례" hidden></section></div>
      <p class="input-help">관심 항목은 이 브라우저에 저장됩니다. 다른 기기와 동기화되지 않습니다.</p>
    </main>
    <dialog id="mh-detail" aria-labelledby="mh-detail-title"><button id="mh-close" class="back-button">닫기 ×</button><div id="mh-detail-body"></div></dialog>
    <dialog id="mh-comparison" aria-labelledby="mh-comparison-title">
      <button type="button" id="mh-comparison-close" class="back-button">닫기 ×</button>
      <h2 id="mh-comparison-title">관심 항목 두 개 비교하기</h2>
      <div id="mh-comparison-body"></div>
    </dialog>`
  const $ = selector => root.querySelector(selector)
  $('#mh-baseline').textContent = `현재 월 통근 부담 ${money(baseline)}${demo ? ' (데모)' : ''}`
  $('#mh-destination').textContent = `목적지: ${destination}`
  $('#mh-back').onclick = back
  $('#mh-intro').onclick = intro
  const dialog = $('#mh-detail')
  $('#mh-close').onclick = () => dialog.close()
  const comparison = $('#mh-comparison')
  let comparisonSelection = new Set()
  $('#mh-comparison-close').onclick = () => comparison.close()
  function showComparisonPicker() {
    const savedHomes = homes.filter(home => favorites.has(home.id))
    comparisonSelection = new Set([...comparisonSelection].filter(id => favorites.has(id)))
    const body = $('#mh-comparison-body')
    body.innerHTML = `<p>비교할 관심 항목을 정확히 두 개 선택해주세요.</p><div class="mh-compare-options"></div><p id="mh-selection-count" role="status"></p><button type="button" id="mh-run-comparison" class="primary-button">선택한 두 개 비교하기</button>`
    const count = body.querySelector('#mh-selection-count')
    const run = body.querySelector('#mh-run-comparison')
    const update = () => {
      count.textContent = savedHomes.length < 2 ? '관심 항목을 두 개 이상 저장한 뒤 비교할 수 있어요.' : `${comparisonSelection.size} / 2개 선택`
      run.disabled = comparisonSelection.size !== 2
      for (const input of body.querySelectorAll('input')) input.disabled = !input.checked && comparisonSelection.size === 2
    }
    for (const home of savedHomes) {
      const label = document.createElement('label')
      label.className = 'mh-compare-option'
      const input = document.createElement('input')
      input.type = 'checkbox'; input.value = home.id; input.checked = comparisonSelection.has(home.id)
      const text = document.createElement('span')
      text.textContent = `${home.name} · ${money(homeCost(home, wage).total)} / 월`
      input.onchange = () => {
        if (input.checked && comparisonSelection.size < 2) comparisonSelection.add(home.id)
        else { comparisonSelection.delete(home.id); input.checked = false }
        update()
      }
      label.append(input, text); body.querySelector('.mh-compare-options').append(label)
    }
    run.onclick = () => {
      const pair = [...comparisonSelection].map(id => homes.find(home => home.id === id && favorites.has(id)))
      if (pair.length !== 2 || pair.some(home => !home)) { showComparisonPicker(); return }
      showComparisonTable(pair[0], pair[1])
    }
    update()
  }
  function showComparisonTable(left, right) {
    const body = $('#mh-comparison-body')
    body.innerHTML = `<button type="button" id="mh-reselect" class="back-button">← 비교 대상 다시 선택</button><p class="demo-notice">가상 거래 사례 비교입니다. 실제 거래·통근 경로를 조회한 결과가 아닙니다.</p><table class="mh-compare-table"><caption>선택한 두 항목의 비용과 통근시간 비교</caption><thead><tr><th scope="col" id="mh-left-name"></th><th scope="col">VS · 비교 항목</th><th scope="col" id="mh-right-name"></th></tr></thead><tbody></tbody></table><p id="mh-compare-difference" class="mh-compare-difference"></p><p class="input-help">보증금 기회비용은 연 3% 가정, 시간 비용은 월 20일 기준입니다. 보증금 원금은 진짜 월세 합계에 직접 더하지 않습니다. 관리비·교통비·통근시간은 예시입니다.</p><p id="mh-compare-wage" class="input-help"></p>`
    body.querySelector('#mh-left-name').textContent = `매물 A · ${left.name}`
    body.querySelector('#mh-right-name').textContent = `매물 B · ${right.name}`
    body.querySelector('#mh-compare-wage').textContent = `공통 적용 시급: ${money(wage)}`
    for (const [label, a, b, unit] of comparisonRows(left, right, wage)) {
      const row = document.createElement('tr')
      const l = document.createElement('td'), heading = document.createElement('th'), r = document.createElement('td')
      const display = value => unit === '원' && value % 10000 === 0 ? `${(value/10000).toLocaleString('ko-KR')}만원` : `${value.toLocaleString('ko-KR')}${unit}`
      l.textContent = display(a); r.textContent = display(b); heading.textContent = label; heading.scope = 'row'
      if (a < b) l.className = 'mh-lower'
      if (b < a) r.className = 'mh-lower'
      if (label === '진짜 월세') row.className = 'mh-total-row'
      row.append(l,heading,r); body.querySelector('tbody').append(row)
    }
    const difference = homeCost(left,wage).total - homeCost(right,wage).total
    body.querySelector('#mh-compare-difference').textContent = difference === 0 ? '두 항목의 진짜 월세가 같아요.' : `매물 ${difference < 0 ? 'A' : 'B'}의 진짜 월세가 월 ${money(Math.abs(difference))} 낮아요.`
    body.querySelector('#mh-reselect').onclick = showComparisonPicker
    comparison.scrollTop = 0
    body.querySelector('#mh-reselect').focus()
  }
  $('#mh-compare').onclick = () => {
    showComparisonPicker()
    comparison.showModal()
  }
  function toggle(id) {
    if (favorites.has(id)) favorites.delete(id); else favorites.add(id)
    try {
      localStorage.setItem(storageKey, JSON.stringify([...favorites]))
      $('#mh-status').textContent = favorites.has(id) ? '관심 항목으로 저장했어요.' : '관심 저장을 해제했어요.'
    } catch { $('#mh-status').textContent = '현재 화면에만 반영했어요. 브라우저 저장을 사용할 수 없습니다.' }
    render()
  }
  function saveButton(home) {
    const button = document.createElement('button')
    const saved = favorites.has(home.id)
    button.className = 'mh-save'
    button.textContent = saved ? '★ 저장됨' : '☆ 관심 저장'
    button.setAttribute('aria-pressed', String(saved))
    button.setAttribute('aria-label', `${home.name} ${saved ? '관심 해제' : '관심 저장'}`)
    button.onclick = () => toggle(home.id)
    return button
  }
  function detail(home) {
    const cost = homeCost(home, wage)
    const body = $('#mh-detail-body')
    body.innerHTML = `<span class="badge">가상 거래 사례</span><h2 id="mh-detail-title"></h2><strong class="mh-price"></strong><dl class="cost-list"></dl><p class="input-help">보증금 연이율 3% 가정 · 월 20일 · 관리비 추정치. 통근시간·교통비·위치는 예시이며 실제 주소를 의미하지 않습니다.</p>`
    body.querySelector('h2').textContent = home.name
    body.querySelector('.mh-price').textContent = `진짜 월세 ${money(cost.total)}`
    const rows = [['보증금',money(home.deposit)],['보증금 월 기회비용',money(cost.opportunity)],['월세',money(home.rent)],['추정 관리비',money(home.fee)],['예시 월 교통비',money(home.travel)],['예시 왕복 통근시간',`${home.minutes}분`],['시간 비용 적용 시급',money(wage)],['월 시간 비용',money(cost.time)]]
    for (const [label, value] of rows) {
      const row = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd')
      dt.textContent = label; dd.textContent = value; row.append(dt, dd); body.querySelector('dl').append(row)
    }
    const actions = document.createElement('div')
    actions.className = 'mh-detail-actions'

const save = saveButton(home)
save.onclick = () => {
  toggle(home.id)
  detail(home)
}

const contact = document.createElement('button')
contact.type = 'button'
contact.className = 'mh-contact'
contact.textContent = '문의하기'
contact.onclick = () => {
  alert('아직 미구현됨')
}

actions.append(save, contact)
body.append(actions)
    if (!dialog.open) dialog.showModal()
  }
  function visibleHomes() {
    return homes.filter(home => onlySaved ? favorites.has(home.id) : home.region === selected.name)
      .sort((a,b) => homeCost(a,wage).total - homeCost(b,wage).total)
  }
  function render() {
    const visible = visibleHomes()
    $('#mh-empty-map').hidden = view !== 'map' || visible.length > 0
    $('#mh-empty-map').textContent = onlySaved ? '저장한 관심 항목이 없어요. 목록 보기에서 관심 항목을 저장해보세요.' : '이 지역에는 샘플 거래 이력이 없어요. 다른 지역을 검색해보세요.'
    $('#mh-saved').textContent = `${onlySaved ? '★' : '☆'} 관심만 보기 (${favorites.size})`
    $('#mh-saved').setAttribute('aria-pressed', String(onlySaved))
    $('#mh-count').textContent = `${onlySaved ? '전체 지역 관심 항목' : selected.name} · ${visible.length}건 · 낮은 금액순`
    $('#mh-compare').hidden = !onlySaved
    $('#mh-list').replaceChildren()
    layer?.clearLayers()
    if (!visible.length) {
      const empty = document.createElement('p')
      empty.className = 'mh-empty'
      empty.textContent = onlySaved ? '저장한 관심 항목이 없어요. ☆ 관심 저장을 눌러보세요.' : '이 지역에는 샘플 거래 이력이 없어요. 다른 지역을 검색해보세요.'
      $('#mh-list').append(empty)
    }
    for (const home of visible) {
      const cost = homeCost(home,wage)
      const card = document.createElement('article')
      card.className = `mh-card ${favorites.has(home.id) ? 'is-saved' : ''}`
      const open = document.createElement('button')
      open.className = 'mh-open'
      const title = document.createElement('strong'), price = document.createElement('span')
      title.textContent = home.name; price.textContent = `진짜 월세 ${money(cost.total)}`
      open.append(title,price); open.onclick = () => detail(home)
      card.append(open,saveButton(home)); $('#mh-list').append(card)
      if (map && layer) {
        const saved = favorites.has(home.id)
        const marker = window.L.marker(home.point, {
          title: `${home.name} ${saved ? '관심 저장됨' : ''}`,
          icon: window.L.divIcon({ className: 'mh-pin-wrapper', html: `<span class="mh-pin ${saved ? 'saved' : ''}">${saved ? '★ ' : ''}${Math.round(cost.total/10000)}만</span>`, iconSize: [90,38], iconAnchor: [45,38] }),
          zIndexOffset: saved ? 1000 : 0,
        }).addTo(layer)
        marker.on('click', () => detail(home))
      }
    }
  }
  function fitResults() {
    needsFit = true
    if (!map || view !== 'map') return
    const visible = visibleHomes()
    if (onlySaved && visible.length) map.fitBounds(visible.map(home => home.point), { padding: [40,40], maxZoom: 15 })
    else map.setView(selected.center,14)
    needsFit = false
  }
  function changeView(next) {
    view = next
    $('#mh-map-panel').hidden = view !== 'map'
    $('#mh-list').hidden = view !== 'list'
    $('#mh-view-map').setAttribute('aria-pressed', String(view === 'map'))
    $('#mh-view-list').setAttribute('aria-pressed', String(view === 'list'))
    $('#mh-empty-map').hidden = view !== 'map' || visibleHomes().length > 0
    if (view === 'map') {
      requestAnimationFrame(() => {
        if (disposed || view !== 'map') return
        map?.invalidateSize({ pan: false })
        if (needsFit) fitResults()
      })
    }
  }
  $('#mh-view-map').onclick = () => changeView('map')
  $('#mh-view-list').onclick = () => changeView('list')
  $('#mh-saved').onclick = () => {
    onlySaved = !onlySaved; render()
    fitResults()
  }
  $('#mh-search').onsubmit = event => {
    event.preventDefault()
    const query = $('#mh-region').value.trim().replace(/\s+/g,'')
    const region = query && regions.find(item => query.includes(item.name) || item.aliases.some(alias => query.includes(alias)))
    if (!region) { $('#mh-status').textContent = '지원 지역을 입력해주세요: 봉천동, 신림동, 역삼동, 마포구. 기존 지도는 유지됩니다.'; return }
    selected = region; onlySaved = false; render(); fitResults()
    $('#mh-status').textContent = `${region.name}의 샘플 사례를 표시합니다.`
  }
  async function init() {
    $('#mh-retry').hidden = true
    $('#mh-status').textContent = '지도를 불러오고 있어요…'
    try {
      const L = await loadLeaflet()
      if (disposed) return
      map?.remove()
      map = L.map($('#mh-map')).setView(selected.center,14)
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:19, attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' })
        .on('tileerror', () => { if (!disposed) { $('#mh-status').textContent = '지도 배경 일부를 불러오지 못했어요. 목록과 관심 저장은 사용할 수 있습니다.'; $('#mh-retry').hidden = false } }).addTo(map)
      layer = L.layerGroup().addTo(map)
      render(); fitResults(); $('#mh-status').textContent = '지도 마커 또는 목록 항목을 누르면 상세를 볼 수 있어요. ★는 관심 항목입니다.'
    } catch(error) { if (!disposed) { $('#mh-status').textContent = error.message; $('#mh-retry').hidden = false } }
  }
  $('#mh-retry').onclick = init
  render(); init()
  window.scrollTo(0,0); $('#mh-title').focus()
  return () => { disposed = true; if (dialog.open) dialog.close(); if (comparison.open) comparison.close(); map?.remove() }
}

