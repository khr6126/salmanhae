import './map-home.css'

const storageKey = 'salmanhae-api-favorites-v1'
const money = value => typeof value === 'number' && Number.isFinite(value)
  ? `${value.toLocaleString('ko-KR')}원` : '계산 불가'
const minutes = value => typeof value === 'number' && Number.isFinite(value) ? `${value}분` : '확인 불가'
const validCost = home => home.calculation_status === 'ok'
  && typeof home.costs?.monthly_total_cost === 'number' && Number.isFinite(home.costs.monthly_total_cost)
const routeNames = { public: '대중교통', car: '자가용', walk: '도보' }

export function coordinatesPoint(coordinates) {
  if (coordinates?.x == null || coordinates?.y == null || coordinates.x === '' || coordinates.y === '') return null
  const lat = Number(coordinates.y), lng = Number(coordinates.x)
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lat, lng] : null
}

export function sortedProperties(homes) {
  return [...homes].sort((a, b) => Number(!validCost(a)) - Number(!validCost(b))
    || (validCost(a) && validCost(b) ? a.costs.monthly_total_cost - b.costs.monthly_total_cost : 0)
    || a.id - b.id)
}

export function groupedProperties(homes) {
  const groups = new Map()
  for (const home of homes) {
    if (!coordinatesPoint(home.coordinates)) continue
    if (!groups.has(home.address)) groups.set(home.address, [])
    groups.get(home.address).push(home)
  }
  return [...groups.values()]
}

function routeDescription(home) {
  if (!home.commute) return '확인 불가'
  return `가는 길 ${routeNames[home.commute.outbound_route_type] || '확인 불가'} / 오는 길 ${routeNames[home.commute.inbound_route_type] || '확인 불가'}`
}

// 금액은 API 응답을 그대로 사용합니다. 소계는 표시용이며 다시 합산하지 않습니다.
export function receiptRows(home, mode) {
  const c = home.costs || {}
  return [
    ['초기 보증금 (월 합계 제외)', money(home.deposit)],
    ['월세', money(c.monthly_rent)],
    ['월 관리비', money(c.monthly_maintenance_fee)],
    [mode === 'car' ? '월 유류비' : '월 교통비', money(c.monthly_transport_cost)],
    ['월 현금 지출 소계', money(c.monthly_cash_expense)],
    ['월 보증금 기회비용', money(c.monthly_deposit_opportunity_cost)],
    ['월 주거비 소계', money(c.monthly_housing_cost)],
    ['왕복 이동시간', minutes(home.commute?.round_trip_time_minutes)],
    ['실제 계산 이동수단', routeDescription(home)],
    ['월 시간 기회비용', money(c.monthly_opportunity_cost)],
    ['월 전체 비용', validCost(home) ? money(c.monthly_total_cost) : '계산 불가'],
  ]
}

function loadFavorites(homes) {
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


export function mountMapHome(root, { baseline, result, destination, back, intro }) {
  const homes = sortedProperties(result.properties)
  const favorites = loadFavorites(homes)
  const destinationPoint = coordinatesPoint(result.destination_coordinates)
  const a = result.assumptions || {}
  const basis = `연 금리 ${typeof a.annual_base_rate === 'number' ? (a.annual_base_rate * 100).toLocaleString('ko-KR') : '?'}%${a.base_rate_source === 'development_assumption' ? ' 개발용 가정' : ''} · 월 ${a.commute_days_per_month}일 · 시급 ${money(a.minimum_wage)}. 보증금 원금은 월 합계에서 제외합니다.`
    + (result.transport_mode === 'car' ? ` 연비 ${a.fuel_efficiency_km_per_liter}km/L · 유가 ${money(a.fuel_price_per_liter)}/L 고정. 주차비·통행료 제외.` : '')
  let onlySaved = false, query = '', view = 'map'
  let map, layer, disposed = false
  let selection = new Set()
  root.innerHTML = `
    <header class="header"><button class="brand mh-link" id="mh-intro">살만해<span>.</span></button><span>매물 비용 비교</span></header>
    <main class="mh-page">
      <button class="back-button" id="mh-back">← 통근 비용 다시 보기</button>
      <h1 tabindex="-1" id="mh-title">매물별 월 전체 비용을 비교하세요.</h1>
      <div class="mh-baseline"><strong id="mh-baseline"></strong><span id="mh-destination"></span></div>
      <p class="demo-notice" id="mh-source"></p>
      <p class="input-help" id="mh-basis"></p>
      <form class="mh-search" id="mh-search"><label for="mh-region">이름·주소 검색</label><input id="mh-region" placeholder="대광, 안암, 도로명" maxlength="100"><button class="primary-button">검색</button></form>
      <p class="input-help">받아온 매물 안에서 검색합니다. 검색어를 지우고 검색하면 전체가 표시됩니다.</p>
      <div class="mh-toolbar">
        <div class="mh-view-switch" role="group" aria-label="결과 보기 방식">
          <button id="mh-view-map" aria-pressed="true" aria-controls="mh-map-panel">지도 보기</button>
          <button id="mh-view-list" aria-pressed="false" aria-controls="mh-list">목록 보기</button>
        </div>
        <button id="mh-saved" aria-pressed="false">☆ 관심만 보기</button><span id="mh-count"></span>
        <button id="mh-compare">관심 항목 비교하기</button>
      </div>
      <p role="status" id="mh-status"></p>
      <div class="mh-layout"><section id="mh-map-panel" aria-label="매물 지도"><div id="mh-map"></div><button id="mh-retry" hidden>지도 다시 불러오기</button></section><section class="mh-list" id="mh-list" aria-label="월 전체 비용순 매물 목록" hidden></section></div>
      <p class="input-help">같은 주소는 한 마커로 묶습니다. 계산 불가 매물은 목록 끝에 표시되며 비교 대상에서 제외됩니다. 관심 항목은 이 브라우저에 저장됩니다.</p>
    </main>
    <dialog id="mh-detail" aria-labelledby="mh-detail-title"><button id="mh-close" class="back-button">닫기 ×</button><div id="mh-detail-body"></div></dialog>
    <dialog id="mh-comparison" aria-labelledby="mh-comparison-title"><button id="mh-comparison-close" class="back-button">닫기 ×</button><h2 id="mh-comparison-title">관심 항목 두 개 비교하기</h2><div id="mh-comparison-body"></div></dialog>`
  const $ = selector => root.querySelector(selector)
  $('#mh-baseline').textContent = `현재 월 통근 부담 ${money(baseline)}`
  $('#mh-destination').textContent = `목적지: ${destination}`
  $('#mh-source').textContent = result.data_source === 'mock'
    ? '목업 매물 전체를 비교합니다. 현재 거래 가능한 매물이나 목적지 반경 검색 결과가 아닙니다. 이동 비용은 입력한 목적지와 이동수단을 기준으로 서버에서 계산했습니다.'
    : '서버에서 받은 매물의 주거비와 이동 비용을 비교합니다.'
  $('#mh-basis').textContent = basis
  $('#mh-back').onclick = back
  $('#mh-intro').onclick = intro
  const detailDialog = $('#mh-detail'), comparison = $('#mh-comparison')
  $('#mh-close').onclick = () => detailDialog.close()
  $('#mh-comparison-close').onclick = () => comparison.close()

  function saveButton(home) {
    const button = document.createElement('button')
    const saved = favorites.has(home.id)
    button.className = 'mh-save'
    button.textContent = saved ? '★ 저장됨' : '☆ 관심 저장'
    button.setAttribute('aria-pressed', String(saved))
    button.setAttribute('aria-label', `${home.name} ${saved ? '관심 해제' : '관심 저장'}`)
    button.onclick = () => {
      if (favorites.has(home.id)) favorites.delete(home.id); else favorites.add(home.id)
      try { localStorage.setItem(storageKey, JSON.stringify([...favorites])) }
      catch { $('#mh-status').textContent = '현재 화면에만 저장했습니다. 브라우저 저장을 사용할 수 없습니다.' }
      render()
      if (detailDialog.open) detail(home)
    }
    return button
  }

  function detail(home) {
    const body = $('#mh-detail-body')
    body.innerHTML = '<h2 id="mh-detail-title"></h2><p class="mh-address"></p><strong class="mh-price"></strong><p class="mh-error"></p><dl class="cost-list"></dl><p class="input-help"></p>'
    body.querySelector('h2').textContent = home.name
    body.querySelector('.mh-address').textContent = home.address
    body.querySelector('.mh-price').textContent = validCost(home) ? `월 전체 비용 ${money(home.costs.monthly_total_cost)}` : '전체 비용 계산 불가'
    body.querySelector('.mh-error').textContent = home.error || ''
    body.querySelector('.input-help').textContent = basis
    for (const [label, value] of receiptRows(home, result.transport_mode)) {
      const row = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd')
      dt.textContent = label; dd.textContent = value; row.append(dt, dd); body.querySelector('dl').append(row)
    }
    body.append(saveButton(home))
    if (!detailDialog.open) detailDialog.showModal()
  }

  function comparisonPicker() {
    const saved = homes.filter(home => favorites.has(home.id) && validCost(home))
    selection = new Set([...selection].filter(id => saved.some(home => home.id === id)))
    const body = $('#mh-comparison-body')
    body.innerHTML = '<p>계산 가능한 관심 매물 중 두 개를 선택하세요.</p><div class="mh-compare-options"></div><p role="status" id="mh-selection-count"></p><button class="primary-button" id="mh-run-comparison">선택한 두 개 비교하기</button>'
    const update = () => {
      body.querySelector('#mh-selection-count').textContent = saved.length < 2 ? '계산 가능한 매물을 두 개 이상 관심 저장해주세요.' : `${selection.size} / 2개 선택`
      body.querySelector('#mh-run-comparison').disabled = selection.size !== 2
      for (const input of body.querySelectorAll('input')) input.disabled = !input.checked && selection.size === 2
    }
    for (const home of saved) {
      const label = document.createElement('label'), input = document.createElement('input'), text = document.createElement('span')
      label.className = 'mh-compare-option'; input.type = 'checkbox'; input.checked = selection.has(home.id)
      text.textContent = `${home.name} · ${money(home.costs.monthly_total_cost)} / 월`
      input.onchange = () => {
        if (input.checked && selection.size < 2) selection.add(home.id)
        else { selection.delete(home.id); input.checked = false }
        update()
      }
      label.append(input, text); body.querySelector('.mh-compare-options').append(label)
    }
    body.querySelector('#mh-run-comparison').onclick = () => {
      const pair = [...selection].map(id => saved.find(home => home.id === id))
      if (pair.length === 2 && pair.every(Boolean)) comparisonTable(...pair)
    }
    update()
  }

  function comparisonTable(left, right) {
    const body = $('#mh-comparison-body')
    body.innerHTML = '<button class="back-button" id="mh-reselect">← 비교 대상 다시 선택</button><table class="mh-compare-table"><caption>매물별 비용 영수증</caption><thead><tr><th id="mh-left-name" scope="col"></th><th scope="col">항목</th><th id="mh-right-name" scope="col"></th></tr></thead><tbody></tbody></table><p class="mh-compare-difference"></p><p class="input-help"></p>'
    body.querySelector('#mh-left-name').textContent = `${left.name} · ${left.address}`
    body.querySelector('#mh-right-name').textContent = `${right.name} · ${right.address}`
    const rightRows = receiptRows(right, result.transport_mode)
    receiptRows(left, result.transport_mode).forEach(([label, value], index) => {
      const row = document.createElement('tr'), l = document.createElement('td'), h = document.createElement('th'), r = document.createElement('td')
      l.textContent = value; h.textContent = label; h.scope = 'row'; r.textContent = rightRows[index][1]
      if (label === '월 전체 비용') row.className = 'mh-total-row'
      row.append(l, h, r); body.querySelector('tbody').append(row)
    })
    const difference = left.costs.monthly_total_cost - right.costs.monthly_total_cost
    body.querySelector('.mh-compare-difference').textContent = difference === 0 ? '두 매물의 월 전체 비용이 같습니다.' : `${difference < 0 ? left.name : right.name}의 월 전체 비용이 ${money(Math.abs(difference))} 낮습니다.`
    body.querySelector('.input-help').textContent = basis
    body.querySelector('#mh-reselect').onclick = comparisonPicker
  }
  $('#mh-compare').onclick = () => { comparisonPicker(); comparison.showModal() }

  const visibleHomes = () => homes.filter(home => (!onlySaved || favorites.has(home.id))
    && `${home.name} ${home.address}`.replace(/\s+/g, '').toLowerCase().includes(query))

  function render() {
    const visible = visibleHomes()
    $('#mh-count').textContent = `${visible.length}건 · 월 전체 비용순`
    $('#mh-saved').textContent = `${onlySaved ? '★' : '☆'} 관심만 보기 (${favorites.size})`
    $('#mh-saved').setAttribute('aria-pressed', String(onlySaved))
    $('#mh-list').replaceChildren()
    if (!visible.length) {
      const empty = document.createElement('p'); empty.className = 'mh-empty'
      empty.textContent = '조건에 맞는 매물이 없습니다. 검색어 또는 관심 필터를 확인해주세요.'; $('#mh-list').append(empty)
    }
    for (const home of visible) {
      const card = document.createElement('article'), button = document.createElement('button')
      card.className = `mh-card ${favorites.has(home.id) ? 'is-saved' : ''}`; button.className = 'mh-open'
      for (const value of [home.name, home.address, validCost(home) ? `월 전체 비용 ${money(home.costs.monthly_total_cost)}` : `계산 불가: ${home.error || '경로 정보 없음'}`]) {
        const text = document.createElement('span'); text.textContent = value; button.append(text)
      }
      button.onclick = () => detail(home); card.append(button, saveButton(home)); $('#mh-list').append(card)
    }
    if (!map || !layer) return
    layer.clearLayers()
    if (destinationPoint) window.L.marker(destinationPoint, { title: '목적지' }).addTo(layer).bindPopup(document.createTextNode(`목적지: ${destination}`))
    for (const group of groupedProperties(visible)) {
      const lowest = group.find(validCost)
      const label = `${group.length}개 · ${lowest ? `${Math.round(lowest.costs.monthly_total_cost / 10000)}만~` : '계산 불가'}`
      const popup = document.createElement('div'), address = document.createElement('p')
      address.textContent = group[0].address; popup.append(address)
      for (const home of group) {
        const button = document.createElement('button'); button.className = 'mh-open'
        button.textContent = `${home.name} · ${validCost(home) ? money(home.costs.monthly_total_cost) : '계산 불가'}`
        button.onclick = () => detail(home); popup.append(button)
      }
      window.L.marker(coordinatesPoint(group[0].coordinates), {
        title: `${group[0].address} · ${group.length}개 매물`,
        icon: window.L.divIcon({ className: 'mh-pin-wrapper', html: `<span class="mh-pin">${label}</span>`, iconSize: [110, 38], iconAnchor: [55, 38] }),
      }).addTo(layer).bindPopup(popup)
    }
  }

  function fitResults() {
    if (!map || view !== 'map') return
    const points = visibleHomes().map(home => coordinatesPoint(home.coordinates)).filter(Boolean)
    if (destinationPoint) points.push(destinationPoint)
    if (points.length) map.fitBounds(points, { padding: [40, 40], maxZoom: 16 })
  }
  function changeView(next) {
    view = next
    $('#mh-map-panel').hidden = view !== 'map'; $('#mh-list').hidden = view !== 'list'
    $('#mh-view-map').setAttribute('aria-pressed', String(view === 'map'))
    $('#mh-view-list').setAttribute('aria-pressed', String(view === 'list'))
    if (view === 'map') requestAnimationFrame(() => { if (!disposed && view === 'map') { map?.invalidateSize(); fitResults() } })
  }
  $('#mh-view-map').onclick = () => changeView('map')
  $('#mh-view-list').onclick = () => changeView('list')
  $('#mh-saved').onclick = () => { onlySaved = !onlySaved; render(); fitResults() }
  $('#mh-search').onsubmit = event => {
    event.preventDefault(); query = $('#mh-region').value.trim().replace(/\s+/g, '').toLowerCase()
    render(); fitResults(); $('#mh-status').textContent = `${visibleHomes().length}개의 매물을 표시합니다.`
  }
  async function init() {
    $('#mh-retry').hidden = true; $('#mh-status').textContent = '지도를 불러오고 있어요…'
    try {
      const L = await loadLeaflet()
      if (disposed) return
      map?.remove()
      map = L.map($('#mh-map')).setView(destinationPoint || [37.5665, 126.978], 14)
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' })
        .on('tileerror', () => { if (!disposed) { $('#mh-status').textContent = '지도 배경을 불러오지 못했어요. 목록 보기를 이용해주세요.'; $('#mh-retry').hidden = false } }).addTo(map)
      layer = L.layerGroup().addTo(map)
      render(); fitResults(); $('#mh-status').textContent = '주소 마커를 누르면 해당 주소의 매물 목록이 표시됩니다.'
    } catch (error) {
      if (!disposed) { $('#mh-status').textContent = error.message; $('#mh-retry').hidden = false; changeView('list') }
    }
  }
  $('#mh-retry').onclick = init
  render(); init()
  window.scrollTo(0, 0); $('#mh-title').focus()
  return () => { disposed = true; if (detailDialog.open) detailDialog.close(); if (comparison.open) comparison.close(); map?.remove() }
}
