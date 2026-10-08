// "Return to 0801564.xyz" pill (styled like the landing page title highlight).
export const RETURN_URL = 'https://0801564.xyz';
export const returnLinkHtml = (cls = '') =>
  `<div class="return-row ${cls}"><a class="return-link" href="${RETURN_URL}">\u2190 Return to 0801564.xyz</a></div>`;
