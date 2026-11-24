/**
 * "(11) 99876-5432" vira "+5511998765432". Com "+" no começo o número já é internacional e fica
 * como está; sem "+", 12 dígitos ou mais também ficam, e menos que isso assume Brasil (+55).
 * Devolve null se não parecer um telefone.
 */
export function normalizeBrazilPhone(raw: string): string | null {
  const trimmed = raw.trim()
  const digits = trimmed.replace(/\D/g, '')
  if (!digits) return null
  const international = trimmed.startsWith('+')
  const full = international ? digits : digits.replace(/^0+/, '')
  const withCountry = international || full.length >= 12 ? full : `55${full}`
  return withCountry.length >= 10 && withCountry.length <= 15 ? `+${withCountry}` : null
}
