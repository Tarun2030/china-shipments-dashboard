// Serverless proxy — fetches the published Google Sheet CSVs server-side.
// Browser never talks to Google directly, so CORS can never block it.

export default async function handler(req, res) {
  const SUMMARY_URL  = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQdLQor2-Sr5lhUFaVza7jOaQHJ_hNjSYqdOWBAo9GaHA0zm6NBIVp-q_pluLnT-g/pub?gid=1183905827&single=true&output=csv';
  const CONTRACT_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQdLQor2-Sr5lhUFaVza7jOaQHJ_hNjSYqdOWBAo9GaHA0zm6NBIVp-q_pluLnT-g/pub?gid=699343331&single=true&output=csv';

  try {
    const [sRes, cRes] = await Promise.all([
      fetch(SUMMARY_URL),
      fetch(CONTRACT_URL),
    ]);
    const [summary, contract] = await Promise.all([sRes.text(), cRes.text()]);

    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.status(200).json({ summary, contract, fetchedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
