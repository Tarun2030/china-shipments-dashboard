// Serverless proxy — fetches the published Google Sheet CSVs server-side.
// Browser never talks to Google directly, so CORS can never block it.
//
// The contract feed is assembled here rather than in the browser. Two tabs of the SAME workbook are
// joined: the execution tracker supplies every quantity, the contract register supplies the
// descriptive columns the tracker does not carry (buyer, commodity, payment terms, $/MT). The
// tracker is the sole authority on numbers — where the register disagrees (it books HK2928 at
// 10,400 MT against the tracker's 0) the tracker wins, because it is the sheet the desk actually
// keeps. The result is emitted with the same header names the page already parses, so the render
// layer is untouched by where the data came from.

const SHEET_ID     = '1FBnIr809kmZ9BYRxXZjNnr-Tw8fuFjwNacdkrJWLzcQ';
const TRACKER_GID  = '1333970818'; // execution tracker — authoritative for all quantities
const REGISTER_GID = '1324373246'; // contract register — buyer / commodity / terms / rate
const COMMISSION_URL = 'https://docs.google.com/spreadsheets/d/1rqgHdoGKm2DlT3GRDGya1ktFLNm_69DJ/export?format=csv&gid=825128876';

const tabUrl = gid => `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`;

// Tonnage per container, fixed by the trade. The tracker's own TOTAL FCL column is this division
// carried to five decimals (18,000 MT → 692.30769), which is why FCL figures are not whole numbers.
const MT_PER_FCL = 26;

function parseCSV(text){
  const rows=[]; let row=[],f='',q=false;
  for(let i=0;i<text.length;i++){ const c=text[i],n=text[i+1];
    if(q){ if(c==='"'&&n==='"'){f+='"';i++;} else if(c==='"'){q=false;} else {f+=c;} }
    else { if(c==='"'){q=true;} else if(c===','){row.push(f.trim());f='';}
      else if(c==='\n'){row.push(f.trim());rows.push(row);row=[];f='';}
      else if(c!=='\r'){f+=c;} }
  }
  if(f!==''||row.length>0){row.push(f.trim());rows.push(row);}
  return rows;
}
const num = v => parseFloat((v||'').toString().replace(/[^0-9.\-]/g,''))||0;
const csvCell = v => { const s=(v==null?'':String(v)); return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; };
const csvRow = arr => arr.map(csvCell).join(',');

// HK2867-1 and HK2867-2 are two tranches of one commercial position; the commission statement and
// the buyer-gap panel both fold on the base number, so the join does too — but only as a last
// resort, after the fully-qualified id and the china contract no. have both missed.
const baseId = s => (s||'').trim().toUpperCase().replace(/-\d+$/,'');

// The register carries full legal names ("Hunan Jinjian Import & Export Ltd."); every other surface
// on the page — filter chips, buyer concentration, the commission statement — uses the trading name.
// Cut at the first corporate-form word rather than maintaining a hand-kept lookup, so a buyer added
// to the register tomorrow shortens correctly without a code change.
const NAME_STOP = new Set(['import','export','commercial','information','group','trade','co','co.','ltd','ltd.','limited','company','corp','corp.','inc','inc.']);
function shortBuyer(full){
  const words=(full||'').trim().split(/\s+/), out=[];
  for(const w of words){ if(NAME_STOP.has(w.toLowerCase().replace(/,$/,''))) break; out.push(w); }
  return (out.length?out.join(' '):(full||'').trim()).replace(/[,\s]+$/,'');
}

function buildContractCSV(trackerRows, registerRows){
  // Register indexed three ways so the join can degrade: the two sheets disagree on some contract
  // numbers (tracker HK2924 → SB-HNJJ-20260403, register → SB-XMP-20260403) and on some ids
  // (tracker HK2928 → register HK2928-1 / HK2928-2), but never on both at once.
  const byId={}, byContractNo={}, byBase={};
  registerRows.slice(1).forEach(r=>{
    const id=(r[0]||'').trim(); if(!id.toUpperCase().startsWith('HK')) return;
    const rec={ buyer:shortBuyer(r[3]), commodity:(r[4]||'').trim(), rate:num(r[7]), terms:(r[14]||'').trim() };
    byId[id.toUpperCase()]=rec;
    const cno=(r[1]||'').trim().toUpperCase(); if(cno&&!byContractNo[cno]) byContractNo[cno]=rec;
    const b=baseId(id); if(!byBase[b]) byBase[b]=rec;
  });

  const header=['Contract','Row Key','China Contract No','Buyer','Commodity / Route','Contracted MT','Value m ($)',
    'Shipped MT','Pending MT','FCL Contracted','FCL Shipped','FCL Invoiced','FCL Paid','FCL Pending',
    'FCL In Progress','Qty Paid MT','Shipped Value','Paid Value','Custom Invoice','Disport','Terms'];
  const out=[header];
  const tot={cmt:0,smt:0,pmt:0,val:0,fclC:0,fclS:0,fclI:0,fclP:0,fclPd:0,fclProg:0};

  let seq=0;
  trackerRows.slice(1).forEach(r=>{
    const id=(r[0]||'').trim();
    if(!id.toUpperCase().startsWith('HK')) return;
    const cno=(r[1]||'').trim();
    const reg = byId[id.toUpperCase()] || byContractNo[cno.toUpperCase()] || byBase[baseId(id)] || {};

    const cmt=num(r[2]), fclC=num(r[3]), fclS=num(r[4]), smt=num(r[5]), shipVal=num(r[6]);
    const pmt=num(r[7]), fclProg=num(r[8]), fclI=num(r[9]), custInv=(r[10]||'').trim();
    const fclP=num(r[11]), qtyPaid=num(r[12]), paidVal=num(r[13]), fclPd=num(r[14]);
    const disport=(r[15]||'').trim();

    // Contract value is priced, not read: the tracker's VALUE OF SHIPMENT column covers only what has
    // already moved (and is blank on four rows), so contracted value = the register's own $/MT times
    // contracted tonnage. That rate reconciles exactly with the tracker's shipped value on every row
    // that carries one, which is what makes the multiplication safe rather than an estimate.
    const valM = reg.rate ? (reg.rate*cmt)/1e6 : 0;
    const route = [reg.commodity, disport].filter(Boolean).join(' → ');

    tot.cmt+=cmt; tot.smt+=smt; tot.pmt+=pmt; tot.val+=valM;
    tot.fclC+=fclC; tot.fclS+=fclS; tot.fclI+=fclI; tot.fclP+=fclP; tot.fclPd+=fclPd; tot.fclProg+=fclProg;

    out.push([id, id+'#'+(seq++), cno, reg.buyer||'—', route, cmt, valM.toFixed(4),
      smt, pmt, fclC, fclS, fclI, fclP, fclPd,
      fclProg, qtyPaid, shipVal, paidVal, custInv, disport, reg.terms||'']);
  });

  return { csv: out.map(csvRow).join('\n'), tot };
}

// The summary rail was its own hand-maintained tab on the old workbook, which is precisely how it
// drifted a month out of date. It is now derived from the same rows the contract list renders, so
// the two can never disagree again.
function buildSummaryCSV(tot){
  const shipPct = tot.cmt>0?Math.round(tot.smt/tot.cmt*100):0;
  const uninvoiced = tot.fclS-tot.fclI;
  const paidPct = tot.fclI>0?Math.round(tot.fclP/tot.fclI*100):0;
  const rows=[
    ['CHINA SHIPMENTS | Live from the execution tracker','',''],
    [`Source: workbook ${SHEET_ID} · tab ${TRACKER_GID} (quantities) + tab ${REGISTER_GID} (buyer, terms, rate)`,'',''],
    ['','',''],
    ['Metric','Value',''],
    ['Total contracted (operational)', Math.round(tot.cmt), 'MT'],
    ['Total contracted value', tot.val.toFixed(2), 'm USD'],
    ['Shipped so far', Math.round(tot.smt), `MT (${shipPct}%)`],
    ['Pending shipment', Math.round(tot.pmt), `MT (${100-shipPct}%)`],
    ['FCL shipped', Math.round(tot.fclS), ''],
    ['FCL invoiced', Math.round(tot.fclI), ''],
    ['FCL shipped but not invoiced', Math.round(uninvoiced), ''],
    ['FCL paid', Math.round(tot.fclP), `(${paidPct}% of invoiced)`],
    ['FCL payment pending', Math.round(tot.fclPd), ''],
    ['FCL in progress', Math.round(tot.fclProg), 'not yet shipped'],
  ];
  return rows.map(csvRow).join('\n');
}

export default async function handler(req, res) {
  try {
    const [tRes, rRes, mRes] = await Promise.all([
      fetch(tabUrl(TRACKER_GID)),
      fetch(tabUrl(REGISTER_GID)),
      fetch(COMMISSION_URL),
    ]);
    const [trackerText, registerText, commission] = await Promise.all([tRes.text(), rRes.text(), mRes.text()]);

    const { csv: contract, tot } = buildContractCSV(parseCSV(trackerText), parseCSV(registerText));
    const summary = buildSummaryCSV(tot);

    res.setHeader('Cache-Control', 'no-store, max-age=0');
    // Build identity of the deployment currently serving. The dashboard is a single-page app that
    // never navigates, so its HTML/CSS/JS is fetched exactly once — when the tab is opened — and a
    // tab left open all day keeps running old code while happily refreshing new data into it. No
    // cache header can fix that, because nothing ever re-requests the page. The client compares this
    // value against the one it booted with and offers a reload when they diverge.
    const build = process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || 'dev';
    res.status(200).json({ summary, contract, commission, build, mtPerFcl: MT_PER_FCL, fetchedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
