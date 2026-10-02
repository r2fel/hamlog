/* The Monday letter: the same numbers as the page, in a few lines, so the
 * owner doesn't have to go and look. Sent through Brevo (a free mail
 * service) — with no key set, nothing is sent and nothing breaks.
 */

const num = (n) => String(n ?? 0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** "Россия 210 · Италия 14 · Япония 6" — the top few, by their own letters. */
function topLine(list, limit = 8) {
  return list.slice(0, limit).map(([name, n]) => `${name || '—'} ${n}`).join(' · ') || '—';
}

export function digestText(s, statsUrl) {
  return [
    `R2FEL HamLog — за неделю`,
    ``,
    `Пользуются (открывали за 30 дней): ${num(s.active30)}`,
    `Установок всего: ${num(s.total)}`,
    `Новых за неделю: ${num(s.new7)}   за месяц: ${num(s.new30)}`,
    ``,
    `Страны: ${topLine(s.countries)}`,
    `Версии: ${topLine(s.versions, 6)}`,
    `Системы: ${topLine(s.systems, 4)}`,
    ``,
    statsUrl ? `Подробно: ${statsUrl}` : '',
    ``,
    `Считаются копии программы, а не люди, и только те, у кого включена проверка обновлений.`
  ].filter(l => l !== undefined).join('\n');
}

export async function sendDigest(summary, config) {
  const subject = `R2FEL HamLog: ${summary.active30} пользуются, +${summary.new7} за неделю`;
  const text = digestText(summary, config.statsUrl);

  // Whichever way out is set up. Telegram first: it needs no domain, no
  // sender to verify and no telephone — which is what was left after the
  // mail services asked for a phone number from a country they don't list.
  if (config.telegramToken && config.telegramChat) {
    const res = await fetch(`https://api.telegram.org/bot${config.telegramToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: config.telegramChat, text: `${subject}\n\n${text}`,
        disable_web_page_preview: true })
    });
    return { sent: res.ok, how: 'telegram', status: res.status, body: res.ok ? '' : (await res.text()).slice(0, 300) };
  }

  if (config.resendKey && config.mailTo) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${config.resendKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: config.mailFrom || 'R2FEL HamLog <onboarding@resend.dev>',
        to: [config.mailTo],
        subject,
        text
      })
    });
    return { sent: res.ok, how: 'resend', status: res.status, body: res.ok ? '' : (await res.text()).slice(0, 300) };
  }

  if (config.brevoKey && config.mailTo) {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': config.brevoKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: config.mailFrom || config.mailTo, name: 'R2FEL HamLog' },
        to: [{ email: config.mailTo }],
        subject,
        textContent: text
      })
    });
    return { sent: res.ok, how: 'brevo', status: res.status, body: res.ok ? '' : (await res.text()).slice(0, 300) };
  }

  return { sent: false, how: 'none', why: 'nowhere to send it yet' };
}
