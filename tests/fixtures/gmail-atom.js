// Feed Atom do Gmail para os testes (mesmo formato de mail.google.com/mail/u/N/feed/atom).
export function atom(email, entries, unread = entries.length) {
  return `<?xml version="1.0" encoding="UTF-8"?><feed version="0.3" xmlns="http://purl.org/atom/ns#">
<title>Gmail - Inbox for ${email}</title><tagline>New messages in your Gmail Inbox</tagline><fullcount>${unread}</fullcount>
${entries.map((e) => `<entry><title>${e.subject}</title><summary>${e.snippet || ''}</summary>
<link rel="alternate" href="https://mail.google.com/mail/u/0?account_id=${email}&amp;message_id=${e.id}&amp;view=conv" type="text/html" />
<modified>${e.at}</modified><issued>${e.at}</issued><id>tag:gmail.google.com,2004:${e.id}</id>
<author><name>${e.from}</name><email>${e.fromEmail}</email></author></entry>`).join('\n')}</feed>`;
}

