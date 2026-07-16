// Serverless proxy — fetches the published Google Sheet CSVs server-side.
// Browser never talks to Google directly, so CORS can never block it.

export default async function handler(req, res) {
  const SUMMARY_URL    = 'https://docs.google.com/spreadsheets/d/1jpCvCYpZiAAjqhf2cjfDAUw3YtQwFU22rL-Ci99nKAY/export?format=csv&gid=1183905827';
  const CONTRACT_URL   = 'https://docs.google.com/spreadsheets/d/1jpCvCYpZiAAjqhf2cjfDAUw3YtQwFU22rL-Ci99nKAY/export?format=csv&gid=699343331';
  const COMMISSION_URL = 'https://docs.google.com/spreadsheets/d/1rqgHdoGKm2DlT3GRDGya1ktFLNm_69DJ/export?format=csv&gid=825128876';

  try {
    const [sRes, cRes, mRes] = await Promise.all([
      fetch(SUMMARY_URL),
      fetch(CONTRACT_URL),
      fetch(COMMISSION_URL),
    ]);
    const [summary, contract, commission] = await Promise.all([sRes.text(), cRes.text(), mRes.text()]);

    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.status(200).json({ summary, contract, commission, fetchedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
