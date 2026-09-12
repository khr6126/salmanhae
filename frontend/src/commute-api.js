// 실제 백엔드가 준비되면 true를 false로 바꾸고 아래 API 주소/형식을 맞추세요.
export const DEMO_MODE = true
export const COMMUTE_DAYS = 20

export async function getCommuteData(request, signal) {
  if (DEMO_MODE) {
    // 주소로 조회한 결과가 아닌 화면 개발용 고정 예시입니다.
    return {
      demo: true,
      minimumWage: { year: 2026, hourlyWon: 10320 },
      route: request.transport === 'public'
        ? { outboundMinutes: 60, returnMinutes: 65, outboundFareWon: 1600, returnFareWon: 1600 }
        : { outboundMinutes: 40, returnMinutes: 45, outboundKm: 25, returnKm: 27 },
      car: { averageKmPerLiter: 12, fuelWonPerLiter: 1700, fuelType: '휘발유', priceDate: '데모 값' },
    }
  }

  // 팀과 합의할 예정인 API입니다. API 키는 백엔드에서 관리합니다.
  const response = await fetch('/api/commute/estimate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  })
  if (!response.ok) throw new Error('통근 정보를 불러오지 못했어요. 잠시 후 다시 시도해주세요.')
  const data = await response.json()
  return { ...data, demo: false }
}

function number(value, name, positive = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || (positive ? value <= 0 : value < 0)) {
    throw new Error(`${name} 정보가 없거나 올바르지 않아요. 다시 조회해주세요.`)
  }
  return value
}

export function calculateCommute(data, transport, year) {
  if (!['public', 'car'].includes(transport)) throw new Error('이동수단을 확인해주세요.')
  if (data.minimumWage?.year !== year) throw new Error('조회 연도와 최저시급 적용 연도가 달라요.')
  const wage = number(data.minimumWage?.hourlyWon, '최저시급', true)
  const route = data.route || {}
  const minutes = number(route.outboundMinutes, '가는 시간') + number(route.returnMinutes, '오는 시간')
  const hours = minutes / 60 * COMMUTE_DAYS
  let dailyTravel
  let km = null
  if (transport === 'public') {
    dailyTravel = number(route.outboundFareWon, '가는 요금') + number(route.returnFareWon, '오는 요금')
  } else {
    km = number(route.outboundKm, '가는 거리') + number(route.returnKm, '오는 거리')
    dailyTravel = km / number(data.car?.averageKmPerLiter, '평균 연비', true)
      * number(data.car?.fuelWonPerLiter, '유가', true)
  }
  const monthlyTravel = Math.round(dailyTravel * COMMUTE_DAYS)
  const monthlyTime = Math.round(hours * wage)
  return { minutes, hours, km, wage, monthlyTravel, monthlyTime, total: monthlyTravel + monthlyTime }
}
