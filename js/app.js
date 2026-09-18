'use strict';
let CURRENT_YEAR = 'Year 6';
let ACTIVE_CURRICULUM = null;

// ═══════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════
const rnd  = (a,b) => Math.floor(Math.random()*(b-a+1))+a;
const gcd  = (a,b) => b===0 ? Math.abs(a) : gcd(b,a%b);
const lcm  = (a,b) => Math.abs(a*b)/gcd(a,b);
const simp = (n,d) => { const g=gcd(Math.abs(n),Math.abs(d)); return [n/g,d/g]; };
const FR   = (n,d) => d===1 ? `${n}` : `${n}/${d}`;
const MX   = (w,n,d) => n===0 ? `${w}` : `${w} ${n}/${d}`;
const $    = id => document.getElementById(id);

// ═══════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════
let VIEW='dashboard', SEL_STRAND=null, SEL_SUBSTRAND=null, SEL_TOPIC=null;
let Q_NUM=1, STREAK=0, CORRECT=0, CUR_Q=null;
let STEPS_SHOWN=0, WORKING_SHOWN=false, MARKED=null;
let ATTEMPTS=0, MAX_ATTEMPTS=3;
const TOTAL_Q=25;

// Workspace
let wsMode='type'; // default to type so check-answer is immediately usable
let drawTool='pen', drawColor='#1a1a2e', drawSize=4;
let isDrawing=false, lastX=0, lastY=0, startX=0, startY=0, canvasSnapshot=null;
let canvas=null, ctx=null;

// ═══════════════════════════════════════════════════════
//  SMART ANSWER CHECKER
// ═══════════════════════════════════════════════════════

/**
 * normalise() — converts an answer string into a canonical numeric value
 * so we can compare student input with generated answers flexibly.
 * Returns { value, type, tokens } where type is 'number'|'fraction'|'mixed'|'string'
 */
function normalise(raw) {
  if (!raw) return null;
  // strip currency, units, whitespace
  let s = raw.toString()
    .toLowerCase()
    .replace(/[,$°cm²m²ml l km²]/g,'')
    .replace(/\s+/g,' ')
    .trim();

  // unicode fractions → decimal equivalents
  const unicodeFracs = {'½':0.5,'⅓':1/3,'⅔':2/3,'¼':0.25,'¾':0.75,'⅛':0.125,'⅜':0.375,'⅝':0.625,'⅞':0.875,'⅙':1/6,'⅚':5/6,'⅕':0.2,'⅖':0.4,'⅗':0.6,'⅘':0.8};
  for (const [uc, val] of Object.entries(unicodeFracs)) {
    s = s.replace(new RegExp(uc,'g'), val.toString());
  }

  // mixed number: "2 3/4" or "2 3⁄4"
  const mixedMatch = s.match(/^(-?\d+)\s+(\d+)\s*[\/⁄]\s*(\d+)$/);
  if (mixedMatch) {
    const [,w,n,d] = mixedMatch.map(Number);
    return { value: w + n/d, type:'mixed', w, n, d };
  }

  // fraction: "3/4" or "3⁄4"
  const fracMatch = s.match(/^(-?\d+)\s*[\/⁄]\s*(-?\d+)$/);
  if (fracMatch) {
    const [,n,d] = fracMatch.map(Number);
    return { value: n/d, type:'fraction', n, d };
  }

  // plain number or decimal
  const num = parseFloat(s.replace(/,/g,''));
  if (!isNaN(num)) return { value: num, type:'number' };

  // fallback: string comparison
  return { value: s, type:'string' };
}

/**
 * checkAnswer() — the brain.
 * Returns { correct, partial, feedback, hint }
 */
function checkAnswer(studentRaw, correctRaw) {
  const student = normalise(studentRaw);
  const correct = normalise(correctRaw);

  if (!student || student.value === '') {
    return { correct:false, partial:false, feedback:'empty', hint:'Please write your answer first! Use the Type Answer tab or the symbols below.' };
  }

  // Both numeric — compare with tolerance
  if (student.type !== 'string' && correct.type !== 'string') {
    const TOLS = [0, 0.001, 0.01, 0.005];
    for (const tol of TOLS) {
      if (Math.abs(student.value - correct.value) <= tol) {
        return { correct:true, partial:false, feedback:'exact' };
      }
    }

    // Check if they gave a non-simplified fraction (e.g. 6/8 instead of 3/4)
    if (student.type==='fraction' && correct.type==='fraction') {
      if (Math.abs(student.value - correct.value) < 0.001) {
        return { correct:true, partial:true, feedback:'unsimplified',
          hint:`Your value is correct! But remember to simplify: ${FR(...simp(student.n, student.d))} is the simplest form.` };
      }
    }

    // Rounding difference?
    const roundMatch = Math.abs(Math.round(student.value) - correct.value) < 0.001 ||
                       Math.abs(student.value - Math.round(correct.value)) < 0.001;

    // Close but not right?
    const pct = correct.value !== 0 ? Math.abs(student.value - correct.value) / Math.abs(correct.value) : Infinity;
    if (pct < 0.05) {
      return { correct:false, partial:true, feedback:'close',
        hint:`Very close! Check your rounding or calculation. You got ${studentRaw.trim()}, the correct answer is ${correctRaw}.` };
    }

    return { correct:false, partial:false, feedback:'wrong',
      hint: buildHint(student, correct) };
  }

  // String comparison — normalise both
  const sStr = studentRaw.toLowerCase().trim()
    .replace(/[°\s]/g,' ').replace(/\s+/g,' ').trim();
  const cStr = correctRaw.toLowerCase().trim()
    .replace(/[°\s]/g,' ').replace(/\s+/g,' ').trim();

  // Exact string match
  if (sStr === cStr) return { correct:true, partial:false, feedback:'exact' };

  // Partial token match (for multi-part answers like "mean=84, median=88")
  const sToks = extractNumbers(sStr);
  const cToks = extractNumbers(cStr);
  if (cToks.length > 1 && sToks.length > 0) {
    const matched = sToks.filter(sv => cToks.some(cv => Math.abs(sv-cv) < 0.01));
    if (matched.length === cToks.length) return { correct:true, partial:false, feedback:'exact' };
    if (matched.length > 0) {
      return { correct:false, partial:true, feedback:'partial',
        hint:`You got ${matched.length} of ${cToks.length} parts right. Check all parts of the answer.` };
    }
  }

  // Check if any key number in correct answer matches
  if (cToks.length === 1 && sToks.length >= 1) {
    if (sToks.some(sv => Math.abs(sv - cToks[0]) < 0.01)) {
      return { correct:true, partial:false, feedback:'exact' };
    }
  }

  // Check for keyword match (e.g. "greater than", "acute", "true", "false")
  const keywords = ['greater','less','equal','true','false','acute','obtuse','right','linear','improper','proper','complementary'];
  for (const kw of keywords) {
    if (cStr.includes(kw) && sStr.includes(kw)) {
      return { correct:true, partial:false, feedback:'keyword' };
  }
}

  return { correct:false, partial:false, feedback:'wrong',
    hint:`Not quite. Have another look at the question and try again.` };
}

function extractNumbers(str) {
  const matches = str.match(/-?\d+\.?\d*/g) || [];
  return matches.map(Number);
}

function buildHint(student, correct) {
  if (correct.type === 'fraction' || correct.type === 'mixed') {
    return `Check your fraction — make sure you have the right numerator and denominator.`;
  }
  if (correct.value > student.value) {
    return `Your answer is a bit too small. Check your calculation again.`;
  }
  if (correct.value < student.value) {
    return `Your answer is a bit too large. Check your calculation again.`;
  }
  return `Not quite — review your working and try again.`;
}

// Multi-part answer checker (handles answers like "(a) 3/10  (b) 1/2")
function checkMultiPart(studentRaw, correctRaw) {
  // Split by comma, semicolons, or labelled parts
  const splitCorrect = correctRaw.split(/,|;|\(.\)/).map(s=>s.trim()).filter(Boolean);
  const splitStudent = studentRaw.split(/,|;|\(.\)/).map(s=>s.trim()).filter(Boolean);

  if (splitCorrect.length <= 1) return checkAnswer(studentRaw, correctRaw);

  const results = splitCorrect.map((ca, i) => {
    const sa = splitStudent[i] || '';
    return checkAnswer(sa, ca);
  });

  const allCorrect = results.every(r => r.correct);
  const anyCorrect = results.some(r => r.correct);

  if (allCorrect) return { correct:true, partial:false, feedback:'exact' };
  if (anyCorrect) {
    const wrongParts = results.map((r,i) => r.correct ? null : `Part ${String.fromCharCode(97+i)}`).filter(Boolean);
    return { correct:false, partial:true, feedback:'partial',
      hint:`Some parts are right! Check: ${wrongParts.join(', ')}` };
  }
  return { correct:false, partial:false, feedback:'wrong', hint:'Have another look at all parts of the question.' };
}

// ═══════════════════════════════════════════════════════
//  CURRICULUM MAP
// ═══════════════════════════════════════════════════════
const CURRICULUM = {
  number:{label:'Number',emoji:'🔢',color:'#FF6B6B',accent:'#CC2200',bg:'#FFF4F4',
    subStrands:{
      fractions:{label:'Fractions',emoji:'🍕',topics:{
        improperFractions:{label:'Improper Fractions & Mixed Numbers',acCode:'AC9M6N01',gen:genImproper},
        comparingFractions:{label:'Comparing & Ordering Fractions',acCode:'AC9M6N01',gen:genComparing},
        addSubFractions:{label:'Add & Subtract Fractions',acCode:'AC9M6N02',gen:genAddSub},
        multiplyFractions:{label:'Multiply Fractions',acCode:'AC9M6N03',gen:genMultiply},
        divideFractions:{label:'Divide Fractions by Whole Numbers',acCode:'AC9M6N03',gen:genDivide},
      }},
      decimals:{label:'Decimals & Place Value',emoji:'🔣',topics:{
        decimalOps:{label:'Decimal Operations (+, −, ×, ÷)',acCode:'AC9M6N04',gen:genDecimalOps},
        decimalFracPct:{label:'Fractions, Decimals & Percentages',acCode:'AC9M6N05',gen:genFracDecPct},
      }},
      percentages:{label:'Percentages',emoji:'💯',topics:{
        percentAmount:{label:'Percentage of an Amount',acCode:'AC9M6N06',gen:genPercentAmount},
        percentChange:{label:'Discount & Percentage Change',acCode:'AC9M6N06',gen:genPercentChange},
      }},
      integers:{label:'Integers & Negative Numbers',emoji:'➕➖',topics:{
        negativeNumbers:{label:'Negative Numbers & the Number Line',acCode:'AC9M6N07',gen:genNegative},
      }},
    }},
  algebra:{label:'Algebra',emoji:'🔡',color:'#4ECDC4',accent:'#1A8A82',bg:'#F0FFFD',
    subStrands:{
      equations:{label:'Equations & Unknowns',emoji:'⚖️',topics:{
        linearEq:{label:'Solving One-Step & Two-Step Equations',acCode:'AC9M6A01',gen:genLinearEq},
        wordEq:{label:'Writing & Solving Equations from Words',acCode:'AC9M6A01',gen:genWordEq},
      }},
      patterns:{label:'Patterns & Rules',emoji:'🔄',topics:{
        numberPatterns:{label:'Number Patterns & Term Rules',acCode:'AC9M6A02',gen:genPatterns},
        tableOfValues:{label:'Tables of Values & Graphing Rules',acCode:'AC9M6A02',gen:genTableValues},
      }},
    }},
  measurement:{label:'Measurement',emoji:'📏',color:'#45B7D1',accent:'#1A7A9A',bg:'#F0F8FF',
    subStrands:{
      areaPerimeter:{label:'Area & Perimeter',emoji:'📐',topics:{
        rectArea:{label:'Area & Perimeter of Rectangles',acCode:'AC9M6M01',gen:genRectArea},
        compositeShapes:{label:'Composite Shapes',acCode:'AC9M6M01',gen:genComposite},
        triangleArea:{label:'Area of Triangles & Parallelograms',acCode:'AC9M6M01',gen:genTriangleArea},
      }},
      volume:{label:'Volume & Capacity',emoji:'📦',topics:{
        volumeRect:{label:'Volume of Rectangular Prisms',acCode:'AC9M6M02',gen:genVolume},
      }},
      time:{label:'Time',emoji:'⏱️',topics:{
        timeCalc:{label:'Time Calculations & Duration',acCode:'AC9M6M03',gen:genTime},
      }},
    }},
  geometry:{label:'Geometry',emoji:'📐',color:'#A29BFE',accent:'#5A4FCF',bg:'#F5F3FF',
    subStrands:{
      angles:{label:'Angles',emoji:'∠',topics:{
        triangleAngles:{label:'Angles in Triangles & on a Line',acCode:'AC9M6SP01',gen:genTriangleAngles},
        quadAngles:{label:'Angles in Quadrilaterals',acCode:'AC9M6SP01',gen:genQuadAngles},
      }},
      coordinates:{label:'Coordinates & Transformations',emoji:'🗺️',topics:{
        coordinates:{label:'Cartesian Plane & Coordinates',acCode:'AC9M6SP02',gen:genCoordinates},
        transformations:{label:'Reflections, Rotations & Translations',acCode:'AC9M6SP02',gen:genTransformations},
      }},
    }},
  statistics:{label:'Statistics',emoji:'📊',color:'#FD79A8',accent:'#C0145A',bg:'#FFF0F6',
    subStrands:{
      averages:{label:'Data & Averages',emoji:'📈',topics:{
        meanMedianMode:{label:'Mean, Median, Mode & Range',acCode:'AC9M6ST01',gen:genAverages},
        graphInterpret:{label:'Interpreting Graphs & Data',acCode:'AC9M6ST02',gen:genGraphs},
      }},
    }},
  probability:{label:'Probability',emoji:'🎲',color:'#FDCB6E',accent:'#B8860B',bg:'#FFFBF0',
    subStrands:{
      chance:{label:'Chance & Probability',emoji:'🎯',topics:{
        simpleProbability:{label:'Simple Probability (Fractions)',acCode:'AC9M6P01',gen:genSimpleProb},
        expectedFrequency:{label:'Expected Frequency & Experiments',acCode:'AC9M6P02',gen:genExpectedFreq},
        complementaryEvents:{label:'Complementary & Mutually Exclusive Events',acCode:'AC9M6P01',gen:genComplementary},
      }},
    }},
};

// ═══════════════════════════════════════════════════════
//  QUESTION GENERATORS
// ═══════════════════════════════════════════════════════
function genImproper(){
  const types=[
    ()=>{const w=rnd(1,5),n=rnd(1,6),d=rnd(2,9),top=w*d+n;return{q:`Convert the mixed number ${MX(w,n,d)} to an improper fraction.`,a:`${FR(top,d)}`,steps:[`Multiply whole × denominator: ${w} × ${d} = ${w*d}`,`Add numerator: ${w*d} + ${n} = ${top}`,`Place over the original denominator.`,`✅ ${MX(w,n,d)} = ${FR(top,d)}`]};},
    ()=>{const d=rnd(2,9),top=rnd(d+1,d*6),w=Math.floor(top/d),r=top%d;return{q:`Convert ${FR(top,d)} to a mixed number.`,a:`${r===0?w:MX(w,r,d)}`,steps:[`Divide: ${top} ÷ ${d}`,`= ${w} remainder ${r}`,`Whole part = ${w}, remainder ${r} over ${d}`,`✅ ${r===0?w:MX(w,r,d)}`]};},
    ()=>{const d=rnd(3,8),t1=rnd(d+1,d*4),t2=rnd(d+1,d*4),big=Math.max(t1,t2);return{q:`Which improper fraction is greater: ${FR(t1,d)} or ${FR(t2,d)}?`,a:`${FR(big,d)}`,steps:[`Same denominator (${d}): compare numerators.`,`${t1} vs ${t2}: larger numerator = ${big}`,`✅ ${FR(big,d)} is greater.`]};},
    ()=>{const d1=rnd(2,5),d2=rnd(2,5),t1=rnd(d1+1,d1*4),t2=rnd(d2+1,d2*4),v1=t1/d1,v2=t2/d2,big=v1>=v2?`${FR(t1,d1)}`:`${FR(t2,d2)}`;return{q:`Which is greater: ${FR(t1,d1)} or ${FR(t2,d2)}?\nConvert to mixed numbers to compare.`,a:`${big}`,steps:[`${FR(t1,d1)}: ${t1}÷${d1}=${Math.floor(t1/d1)} rem ${t1%d1} → ${MX(Math.floor(t1/d1),t1%d1,d1)}`,`${FR(t2,d2)}: ${t2}÷${d2}=${Math.floor(t2/d2)} rem ${t2%d2} → ${MX(Math.floor(t2/d2),t2%d2,d2)}`,`Decimals: ${v1.toFixed(3)} vs ${v2.toFixed(3)}`,`✅ ${big} is greater.`]};},
    ()=>{const d=rnd(3,7),fs=Array.from({length:4},()=>rnd(d+1,d*5)),sorted=[...fs].sort((a,b)=>a-b);return{q:`Order from smallest to largest:\n${fs.map(f=>FR(f,d)).join(', ')}`,a:sorted.map(f=>FR(f,d)).join(', '),steps:[`Same denominator ${d}: compare numerators: ${fs.join(', ')}`,`Sorted: ${sorted.join(', ')}`,`✅ ${sorted.map(f=>FR(f,d)).join(' < ')}`]};},
    ()=>{const d=rnd(2,8),top=rnd(d+1,d*5),dec=(top/d).toFixed(3);return{q:`Convert ${FR(top,d)} to a decimal (3 decimal places).`,a:`${dec}`,steps:[`Divide numerator by denominator: ${top} ÷ ${d}`,`= ${dec}`,`✅ ${FR(top,d)} = ${dec}`]};},
    ()=>{const d=rnd(3,7),t1=rnd(d+1,d*3),t2=rnd(d+1,d*3),sum=t1+t2,[sn,sd]=simp(sum,d),ans=sn>=sd?MX(Math.floor(sn/sd),sn%sd,sd):FR(sn,sd);return{q:`Calculate: ${FR(t1,d)} + ${FR(t2,d)}.\nGive as a mixed number in simplest form.`,a:ans,steps:[`Add numerators: ${t1}+${t2}=${sum}`,`Fraction: ${FR(sum,d)}`,`Simplify: GCD(${sum},${d})=${gcd(sum,d)} → ${FR(sn,sd)}`,`Convert: ${Math.floor(sn/sd)} rem ${sn%sd}`,`✅ ${ans}`]};},
    ()=>{const d=rnd(2,7),t1=rnd(d*2,d*5),t2=rnd(1,t1-1),diff=t1-t2,[sn,sd]=simp(diff,d),ans=sd===1?`${sn}`:(sn>=sd?MX(Math.floor(sn/sd),sn%sd,sd):FR(sn,sd));return{q:`Calculate: ${FR(t1,d)} − ${FR(t2,d)}. Simplify your answer.`,a:ans,steps:[`Subtract numerators: ${t1}−${t2}=${diff}`,`Fraction: ${FR(diff,d)}`,`Simplify: GCD(${diff},${d})=${gcd(diff,d)} → ${FR(sn,sd)}`,`✅ ${ans}`]};},
    ()=>{const d=rnd(4,8),s1=rnd(d+1,d*3),s2=rnd(d+1,d*3),tot=s1+s2,w=Math.floor(tot/d),r=tot%d;return{q:`A pizza has ${d} slices. Jamie ate ${s1} and Alex ate ${s2}.\nWrite total as a mixed number.`,a:`${MX(w,r,d)}`,steps:[`Total: ${s1}+${s2}=${tot}`,`Improper: ${FR(tot,d)}`,`${tot}÷${d}=${w} rem ${r}`,`✅ ${MX(w,r,d)}`]};},
    ()=>{const d=rnd(3,6),w=rnd(1,4),r=rnd(1,d-1),top=w*d+r;return{q:`${FR(top,d)} sits on a number line.\nBetween which two whole numbers does it lie?`,a:`${w} and ${w+1}`,steps:[`Convert: ${top}÷${d}=${w} rem ${r} → ${MX(w,r,d)}`,`Whole part = ${w}`,`It sits between ${w} and ${w+1}`,`✅ Between ${w} and ${w+1}`]};},
    ()=>{const d=rnd(3,8),w=rnd(2,6),r=rnd(1,d-1),top=w*d+r;return{q:`Find the missing number:\n⬜ / ${d} = ${MX(w,r,d)}`,a:`${top}`,steps:[`${w} × ${d} = ${w*d}`,`${w*d} + ${r} = ${top}`,`✅ Missing = ${top}`]};},
    ()=>{const f=rnd(2,4),sn=rnd(3,7),sd=rnd(2,6),n=sn*f,d=sd*f,[fn,fd]=simp(n,d);return{q:`Write ${FR(n,d)} in simplest form.\nIs the result proper or improper?`,a:`${FR(fn,fd)}`,steps:[`GCD(${n},${d})=${gcd(n,d)}`,`÷${gcd(n,d)}: ${FR(fn,fd)}`,`${fn}${fn>fd?'>':'<'}${fd} → ${fn>fd?'improper':'proper'}`,`✅ ${FR(fn,fd)}`]};},
    ()=>{const d=rnd(3,6),pieces=rnd(d+2,d*4),w=Math.floor(pieces/d),r=pieces%d;return{q:`A project needs ${pieces} pieces of ribbon, each 1/${d} m long.\nHow many full metres must you buy?`,a:`${r>0?w+1:w}`,steps:[`${pieces}×1/${d}=${FR(pieces,d)} m`,`${pieces}÷${d}=${w} rem ${r} → ${MX(w,r,d)}`,`${r>0?'Remainder: buy 1 extra.':'Divides exactly.'}`,`✅ Buy ${r>0?w+1:w} full metres`]};},
    ()=>{const d=rnd(2,6),top=rnd(d+1,d*3),wh=rnd(2,5),prod=top*wh,pw=Math.floor(prod/d),pr=prod%d;return{q:`Calculate ${FR(top,d)} × ${wh}.\nGive your answer as a mixed number.`,a:MX(pw,pr,d),steps:[`${top} × ${wh} = ${prod}`,`${FR(prod,d)}`,`${prod}÷${d}=${pw} rem ${pr}`,`✅ ${MX(pw,pr,d)}`]};},
    ()=>{const d=rnd(3,7),top=rnd(d+1,d*4),w=Math.floor(top/d),r=top%d,claim=rnd(1,w+2),correct=claim===w;return{q:`True or False?\nThe whole-number part of ${FR(top,d)} as a mixed number is ${claim}.`,a:correct?'True':'False',steps:[`${top}÷${d}=${w} rem ${r}`,`Whole = ${w}`,`Claim ${claim} is ${correct?'✓ correct':'✗ wrong'}`,`✅ ${correct?'TRUE':'FALSE'}`]};},
    ()=>{const d=rnd(3,6),bat=rnd(3,7),top=rnd(d+1,d*2),tot=top*bat,w=Math.floor(tot/d),r=tot%d;return{q:`A recipe needs ${FR(top,d)} cups of flour per batch.\nHow much for ${bat} batches? Give as a mixed number.`,a:MX(w,r,d),steps:[`${FR(top,d)} × ${bat} = ${FR(tot,d)}`,`${tot}÷${d}=${w} rem ${r}`,`✅ ${MX(w,r,d)} cups`]};},
    ()=>{const d=rnd(3,7),w=rnd(1,4),r=rnd(1,d-1),top=w*d+r;return{q:`A point is ${r}/${d} of the way between ${w} and ${w+1}.\nWrite as an improper fraction.`,a:FR(top,d),steps:[`Mixed number: ${MX(w,r,d)}`,`${w}×${d}+${r}=${top}`,`✅ ${FR(top,d)}`]};},
    ()=>{const d=rnd(3,8),w=rnd(2,5),top=rnd(w*d-d+1,w*d+d-1),cmp=top>w*d?'greater than':top===w*d?'equal to':'less than';return{q:`Is ${FR(top,d)} greater than, less than, or equal to ${w}?`,a:cmp,steps:[`${w}=${FR(w*d,d)}`,`Compare: ${top} vs ${w*d}`,`✅ ${cmp} ${w}`]};},
    ()=>{const d=rnd(3,6),ts=[rnd(d+1,d*4),rnd(d+1,d*4),rnd(d+1,d*4)],sorted=[...ts].sort((a,b)=>a-b);return{q:`Order least to greatest:\n${ts.map(t=>FR(t,d)).join(', ')}`,a:sorted.map(t=>FR(t,d)).join(', '),steps:[`Same denom ${d}: compare ${ts.join(', ')}`,`Sorted: ${sorted.join(', ')}`,`✅ ${sorted.map(t=>FR(t,d)).join(' < ')}`]};},
    ()=>{const d=rnd(4,8),laps=rnd(d*2,d*5),w=Math.floor(laps/d),r=laps%d;return{q:`A track is 1/${d} km long. Sam runs ${laps} laps.\nHow many full kilometres did Sam run?`,a:`${w}`,steps:[`${laps}×1/${d}=${FR(laps,d)} km`,`${laps}÷${d}=${w} rem ${r} → ${MX(w,r,d)}`,`✅ ${w} full km`]};},
    ()=>{const d=rnd(2,5),top=rnd(d+1,d*4);return{q:`Write TWO equivalent improper fractions for ${FR(top,d)}.\nSeparate with a comma.`,a:`${FR(top*2,d*2)}, ${FR(top*3,d*3)}`,steps:[`×2: ${FR(top*2,d*2)}`,`×3: ${FR(top*3,d*3)}`,`✅ ${FR(top*2,d*2)} and ${FR(top*3,d*3)}`]};},
    ()=>{const d=rnd(4,8),items=rnd(d+2,d*4),price=rnd(1,5),w=Math.floor(items/d),r=items%d,val=((items/d)*price).toFixed(2);return{q:`A bar costs $${price} and is split into ${d} pieces.\nYou have ${items} pieces. What is the total value?`,a:`$${val}`,steps:[`${FR(items,d)} bars`,`${items}÷${d}=${w} rem ${r} → ${MX(w,r,d)}`,`Value=(${items}/${d})×$${price}=$${val}`,`✅ $${val}`]};},
    ()=>{const d=rnd(3,7),top=rnd(d+1,d*4),w=Math.floor(top/d),r=top%d,pct=Math.round((top/d)*100);return{q:`Write ${FR(top,d)} as a percentage (to the nearest whole number).`,a:`${pct}%`,steps:[`${top}÷${d}=${(top/d).toFixed(3)}`,`×100=${pct}%`,`✅ ${pct}%`]};},
    ()=>{const d=rnd(3,6),top=rnd(d+1,d*4),extra=rnd(1,d-1),ans=top+extra;return{q:`Solve for n:\nn − ${FR(extra,d)} = ${FR(top,d)}\nGive your answer as a mixed number.`,a:MX(Math.floor(ans/d),ans%d,d),steps:[`Add ${FR(extra,d)} to both sides`,`n=${FR(top,d)}+${FR(extra,d)}=${FR(ans,d)}`,`${ans}÷${d}=${Math.floor(ans/d)} rem ${ans%d}`,`✅ n=${MX(Math.floor(ans/d),ans%d,d)}`]};},
    ()=>{const d=rnd(4,6),m=rnd(d+1,d*2),af=rnd(d+1,d*2),tot=m+af,eaten=rnd(1,tot-1),left=tot-eaten,[ln,ld]=simp(left,d),aW=Math.floor(ln/ld),aR=ln%ld,ans=ld===1?`${aW}`:(aR===0?`${aW}`:MX(aW,aR,ld));return{q:`A bowl had ${FR(m,d)} kg grapes. Added ${FR(af,d)} kg.\nFamily ate ${FR(eaten,d)} kg. How much is left?\nSimplify to a mixed number.`,a:ans,steps:[`Total: ${FR(m,d)}+${FR(af,d)}=${FR(tot,d)}`,`After eating: ${FR(tot,d)}−${FR(eaten,d)}=${FR(left,d)}`,`Simplify: GCD(${left},${d})=${gcd(left,d)} → ${FR(ln,ld)}`,`Convert: ${aW} rem ${aR}`,`✅ ${ans}`]};},
  ];
  return types[Math.floor(Math.random()*types.length)]();
}

function genComparing(){
  const d1=rnd(2,9),d2=rnd(2,9),n1=rnd(1,d1-1),n2=rnd(1,d2-1);
  const L=lcm(d1,d2),e1=n1*(L/d1),e2=n2*(L/d2),big=e1>=e2?`${FR(n1,d1)}`:`${FR(n2,d2)}`;
  return{q:`Which is greater: ${FR(n1,d1)} or ${FR(n2,d2)}?\nUse a common denominator.`,a:big,steps:[`LCM(${d1},${d2})=${L}`,`${FR(n1,d1)}=${FR(e1,L)}`,`${FR(n2,d2)}=${FR(e2,L)}`,`Compare: ${e1} vs ${e2}`,`✅ ${big} is greater.`]};
}
function genAddSub(){
  const add=rnd(0,1)===1,d1=rnd(2,8),d2=rnd(2,8),n1=rnd(1,d1-1),n2=rnd(1,d2-1);
  const L=lcm(d1,d2),e1=n1*(L/d1),e2=n2*(L/d2),res=add?e1+e2:Math.abs(e1-e2),[sn,sd]=simp(res,L);
  return{q:`Calculate: ${FR(n1,d1)} ${add?'+':'−'} ${FR(n2,d2)}. Simplify your answer.`,a:FR(sn,sd),steps:[`LCM(${d1},${d2})=${L}`,`${FR(n1,d1)}=${FR(e1,L)}, ${FR(n2,d2)}=${FR(e2,L)}`,`${add?'Add':'Subtract'}: ${e1}${add?'+':'−'}${e2}=${res}`,`Simplify: GCD(${res},${L})=${gcd(res,L)} → ${FR(sn,sd)}`,`✅ ${FR(sn,sd)}`]};
}
function genMultiply(){
  const n1=rnd(1,7),d1=rnd(2,9),n2=rnd(1,7),d2=rnd(2,9),rn=n1*n2,rd=d1*d2,[sn,sd]=simp(rn,rd);
  return{q:`Calculate: ${FR(n1,d1)} × ${FR(n2,d2)}. Simplify your answer.`,a:FR(sn,sd),steps:[`Numerators: ${n1}×${n2}=${rn}`,`Denominators: ${d1}×${d2}=${rd}`,`${FR(rn,rd)}`,`GCD(${rn},${rd})=${gcd(rn,rd)} → ${FR(sn,sd)}`,`✅ ${FR(sn,sd)}`]};
}
function genDivide(){
  const n=rnd(1,7),d=rnd(2,8),w=rnd(2,5),[sn,sd]=simp(n,d*w);
  return{q:`Calculate: ${FR(n,d)} ÷ ${w}. Simplify your answer.`,a:FR(sn,sd),steps:[`Keep numerator, multiply denominator by ${w}`,`${FR(n,d*w)}`,`GCD(${n},${d*w})=${gcd(n,d*w)} → ${FR(sn,sd)}`,`✅ ${FR(sn,sd)}`]};
}
function genDecimalOps(){
  const ops=['+','−','×','÷'],op=ops[rnd(0,3)];
  const a=(rnd(10,99)/10).toFixed(1),b=(rnd(10,99)/100).toFixed(2);
  let ans;
  if(op==='+')ans=(parseFloat(a)+parseFloat(b)).toFixed(2);
  else if(op==='−')ans=Math.abs(parseFloat(a)-parseFloat(b)).toFixed(2);
  else if(op==='×')ans=(parseFloat(a)*parseFloat(b)).toFixed(4);
  else ans=(parseFloat(a)/parseFloat(b)).toFixed(3);
  return{q:`Calculate: ${a} ${op} ${b}`,a:`${parseFloat(ans)}`,steps:[`Align decimal points`,`${a} ${op} ${b} = ${ans}`,`✅ ${parseFloat(ans)}`]};
}
function genFracDecPct(){
  const pairs=[[1,2,0.5,50],[1,4,0.25,25],[3,4,0.75,75],[1,5,0.2,20],[2,5,0.4,40],[3,5,0.6,60],[4,5,0.8,80],[1,8,0.125,12.5],[3,8,0.375,37.5],[1,10,0.1,10],[3,10,0.3,30],[7,10,0.7,70]];
  const [n,d,dec,pct]=pairs[rnd(0,pairs.length-1)],ask=rnd(0,2);
  if(ask===0)return{q:`Convert ${FR(n,d)} to a decimal and a percentage.`,a:`${dec}, ${pct}%`,steps:[`${n}÷${d}=${dec}`,`×100=${pct}%`,`✅ ${dec} and ${pct}%`]};
  if(ask===1)return{q:`Convert ${dec} to a fraction (simplest form) and a percentage.`,a:`${FR(n,d)}, ${pct}%`,steps:[`${dec}=${dec*100}/100 → ${FR(n,d)}`,`×100=${pct}%`,`✅ ${FR(n,d)} and ${pct}%`]};
  return{q:`Convert ${pct}% to a fraction (simplest form) and a decimal.`,a:`${FR(n,d)}, ${dec}`,steps:[`${pct}%=${pct}/100 → ${FR(n,d)}`,`÷100=${dec}`,`✅ ${FR(n,d)} and ${dec}`]};
}
function genPercentAmount(){
  const pct=rnd(1,19)*5,amt=rnd(2,20)*10,ans=((pct/100)*amt).toFixed(2);
  return{q:`Find ${pct}% of $${amt}.`,a:`$${ans}`,steps:[`${pct}%=${pct}/100`,`$${amt}×${pct}÷100=$${ans}`,`✅ $${ans}`]};
}
function genPercentChange(){
  const orig=rnd(2,20)*10,disc=rnd(1,8)*5,sale=(orig*(1-disc/100)).toFixed(2),after=(parseFloat(sale)*1.1).toFixed(2);
  return{q:`A jacket costs $${orig}, discounted by ${disc}%.\nWhat is the final price after adding 10% GST to the sale price?`,a:`$${after}`,steps:[`${100-disc}% of $${orig}=$${sale}`,`+10% GST: $${sale}×1.10=$${after}`,`✅ $${after}`]};
}
function genNegative(){
  const types=[
    ()=>{const a=rnd(-15,5),b=rnd(-10,10);return{q:`Calculate: ${a} + (${b})`,a:`${a+b}`,steps:[`Start at ${a}`,`${b>=0?'Move right':'Move left'} ${Math.abs(b)}`,`✅ ${a+b}`]};},
    ()=>{const a=rnd(-5,15),b=rnd(1,20);return{q:`Calculate: ${a} − ${b}`,a:`${a-b}`,steps:[`Subtracting moves left`,`${a}−${b}=${a-b}`,`✅ ${a-b}`]};},
    ()=>{const temps=Array.from({length:5},()=>rnd(-8,15)).sort((a,b)=>a-b);return{q:`Order these temperatures coldest to warmest:\n${[...temps].sort(()=>Math.random()-.5).join('°C, ')}°C`,a:temps.join(', '),steps:[`Negatives are colder (left on number line)`,`Sorted: ${temps.join(', ')}`,`✅ ${temps.join('°C < ')}°C`]};},
  ];
  return types[rnd(0,2)]();
}
function genLinearEq(){
  const types=[
    ()=>{const a=rnd(2,9),b=rnd(1,15),n=rnd(1,12),c=a*n+b;return{q:`Solve for n:\n${a}n + ${b} = ${c}`,a:`${n}`,steps:[`Subtract ${b}: ${a}n=${c-b}`,`÷${a}: n=${n}`,`Check: ${a}×${n}+${b}=${c} ✓`,`✅ n=${n}`]};},
    ()=>{const a=rnd(2,6),b=rnd(2,10),n=rnd(1,8),c=a*n-b;return{q:`Solve for n:\n${a}n − ${b} = ${c}`,a:`${n}`,steps:[`Add ${b}: ${a}n=${c+b}`,`÷${a}: n=${n}`,`✅ n=${n}`]};},
    ()=>{const n=rnd(2,15),d=rnd(2,6);return{q:`Solve for n:\nn ÷ ${d} = ${n}`,a:`${n*d}`,steps:[`×${d} both sides`,`n=${n}×${d}=${n*d}`,`✅ n=${n*d}`]};},
  ];
  return types[rnd(0,2)]();
}
function genWordEq(){
  const types=[
    ()=>{const n=rnd(3,15),tri=n*3+4;return{q:`A triangle's perimeter is ${tri} cm.\nTwo sides are equal and the third is 4 cm.\nFind the length of each equal side.`,a:`${n}`,steps:[`2n+4=${tri}`,`2n=${tri-4}`,`n=${(tri-4)/2}`,`✅ ${n} cm`]};},
    ()=>{const n=rnd(5,20),total=n*2+13;return{q:`Aiden has $${total}. He has $13 more than twice Bella's amount.\nHow much does Bella have?`,a:`${n}`,steps:[`2b+13=${total}`,`2b=${total-13}`,`b=${(total-13)/2}`,`✅ $${n}`]};},
    ()=>{const w=rnd(3,10),l=w+rnd(2,8),P=2*(w+l);return{q:`Rectangle perimeter = ${P} cm, length = ${l} cm.\nFind the width.`,a:`${w}`,steps:[`2(${l}+w)=${P}`,`${l}+w=${P/2}`,`w=${P/2-l}`,`✅ ${w} cm`]};},
  ];
  return types[rnd(0,2)]();
}
function genPatterns(){
  const start=rnd(1,10),diff=rnd(2,9),seq=Array.from({length:5},(_,i)=>start+i*diff),nth=rnd(8,20),nthV=start+(nth-1)*diff;
  return{q:`Pattern: ${seq.join(', ')}, ...\nFind the ${nth}th term.`,a:`${nthV}`,steps:[`Difference: ${diff} (constant)`,`Rule: ${start}+(n−1)×${diff}`,`n=${nth}: ${start}+${nth-1}×${diff}=${nthV}`,`✅ ${nthV}`]};
}
function genTableValues(){
  const m=rnd(2,6),c=rnd(-5,8),xs=[1,2,3,4,5],ys=xs.map(x=>m*x+c),nx=rnd(6,12),ny=m*nx+c;
  return{q:`Rule: y = ${m}x ${c>=0?'+':''}${c}\nFind y when x = ${nx}.`,a:`${ny}`,steps:[...xs.map((x,i)=>`x=${x}: y=${m}×${x}${c>=0?'+':''}${c}=${ys[i]}`),`x=${nx}: y=${m}×${nx}${c>=0?'+':''}${c}=${ny}`,`✅ y=${ny}`]};
}
function genRectArea(){
  const l=rnd(4,25),w=rnd(3,l),ask=rnd(0,1);
  return{q:`Rectangle: ${l} cm × ${w} cm.\nFind the ${ask===0?'area':'perimeter'}.`,a:ask===0?`${l*w}`:`${2*(l+w)}`,steps:[ask===0?`Area=${l}×${w}=${l*w} cm²`:`Perimeter=2(${l}+${w})=${2*(l+w)} cm`,`✅ ${ask===0?l*w:2*(l+w)}`]};
}
function genComposite(){
  const L=rnd(8,20),W=rnd(6,L-2),cL=rnd(2,Math.floor(L/2)),cW=rnd(2,Math.floor(W/2)),area=L*W-cL*cW;
  return{q:`L-shape: outer rectangle ${L}m × ${W}m.\nA corner of ${cL}m × ${cW}m is removed.\nFind the area.`,a:`${area}`,steps:[`Full: ${L}×${W}=${L*W} m²`,`Removed: ${cL}×${cW}=${cL*cW} m²`,`Area=${L*W}−${cL*cW}=${area} m²`,`✅ ${area} m²`]};
}
function genTriangleArea(){
  const b=rnd(4,20),h=rnd(3,15),area=(b*h)/2;
  return{q:`Triangle: base ${b} cm, height ${h} cm.\nFind the area.`,a:`${area}`,steps:[`½×${b}×${h}=${b*h}/2=${area} cm²`,`✅ ${area} cm²`]};
}
function genVolume(){
  const l=rnd(3,15),w=rnd(2,10),h=rnd(2,8),vol=l*w*h;
  return{q:`Rectangular prism: ${l}cm × ${w}cm × ${h}cm.\nFind the volume in cm³.`,a:`${vol}`,steps:[`V=l×w×h=${l}×${w}×${h}=${vol} cm³`,`✅ ${vol} cm³`]};
}
function genTime(){
  const sH=rnd(7,11),sM=rnd(0,55),dH=rnd(1,5),dM=rnd(5,55);
  const endMins=sH*60+sM+dH*60+dM,eH=Math.floor(endMins/60)%24,eM=endMins%60;
  const ap=eH<12?'am':'pm',dispH=eH>12?eH-12:eH===0?12:eH;
  const ans=`${dispH}:${String(eM).padStart(2,'0')} ${ap}`;
  return{q:`Train departs ${sH}:${String(sM).padStart(2,'0')} am.\nJourney: ${dH} hours ${dM} minutes.\nWhat time does it arrive? (12-hour time)`,a:ans,steps:[`Start: ${sH*60+sM} mins`,`Add: ${dH*60+dM} mins`,`Total: ${endMins} mins = ${eH}h ${eM}min`,`✅ ${ans}`]};
}
function genTriangleAngles(){
  const a=rnd(30,80),b=rnd(30,80),c=180-a-b;
  return{q:`Triangle has angles ${a}° and ${b}°.\nFind the third angle.`,a:`${c}`,steps:[`Angles sum to 180°`,`Third=180−${a}−${b}=${c}°`,`✅ ${c}°`]};
}
function genQuadAngles(){
  const a=rnd(60,110),b=rnd(60,110),c=rnd(60,110),d=360-a-b-c;
  return{q:`Quadrilateral has angles ${a}°, ${b}°, ${c}°.\nFind the fourth angle.`,a:`${d}`,steps:[`Angles sum to 360°`,`Fourth=360−${a}−${b}−${c}=${d}°`,`✅ ${d}°`]};
}
function genCoordinates(){
  const x=rnd(1,8),y=rnd(1,8),tx=rnd(-4,4),ty=rnd(-4,4);
  return{q:`Point A is at (${x}, ${y}).\nTranslate ${tx>=0?tx+' right':Math.abs(tx)+' left'} and ${ty>=0?ty+' up':Math.abs(ty)+' down'}.\nWrite the new coordinates as (x, y).`,a:`(${x+tx}, ${y+ty})`,steps:[`x: ${x}${tx>=0?'+'+tx:'−'+Math.abs(tx)}=${x+tx}`,`y: ${y}${ty>=0?'+'+ty:'−'+Math.abs(ty)}=${y+ty}`,`✅ (${x+tx}, ${y+ty})`]};
}
function genTransformations(){
  const x=rnd(1,6),y=rnd(1,6),type=rnd(0,1);
  if(type===0)return{q:`Point P(${x}, ${y}) is reflected across the y-axis.\nWrite the new coordinates.`,a:`(-${x}, ${y})`,steps:[`y-axis: x changes sign`,`(${x},${y}) → (−${x},${y})`,`✅ (−${x}, ${y})`]};
  return{q:`Point P(${x}, ${y}) is reflected across the x-axis.\nWrite the new coordinates.`,a:`(${x}, -${y})`,steps:[`x-axis: y changes sign`,`(${x},${y}) → (${x},−${y})`,`✅ (${x}, −${y})`]};
}
function genAverages(){
  const count=rnd(5,9),data=Array.from({length:count},()=>rnd(40,99)).sort((a,b)=>a-b);
  const sum=data.reduce((s,v)=>s+v,0),mean=(sum/count).toFixed(1);
  const median=count%2===0?((data[count/2-1]+data[count/2])/2).toFixed(1):data[Math.floor(count/2)];
  const range=data[count-1]-data[0];
  return{q:`Find the mean, median, and range of:\n${data.join(', ')}`,a:`${mean}, ${median}, ${range}`,steps:[`Sorted: ${data.join(', ')}`,`Mean=(${data.join('+')})/  ${count}=${sum}/${count}=${mean}`,count%2===0?`Median=(${data[count/2-1]}+${data[count/2]})/2=${median}`:`Median=position ${Math.ceil(count/2)}=${median}`,`Range=${data[count-1]}−${data[0]}=${range}`,`✅ Mean=${mean}, Median=${median}, Range=${range}`]};
}
function genGraphs(){
  const total=rnd(20,40),cats=['Football','Cricket','Basketball','Swimming','Tennis'].slice(0,rnd(3,5));
  let rem=total;
  const vals=cats.map((_,i)=>{if(i===cats.length-1)return rem;const v=rnd(2,Math.floor(rem/(cats.length-i)));rem-=v;return v;});
  const bigI=vals.indexOf(Math.max(...vals));
  return{q:`${total} students chose a sport:\n${cats.map((c,i)=>c+': '+vals[i]).join(', ')}\nWhat percentage chose ${cats[bigI]}? (nearest whole number)`,a:`${Math.round(vals[bigI]/total*100)}`,steps:[`${vals[bigI]}/${total}×100=${(vals[bigI]/total*100).toFixed(1)}%`,`≈${Math.round(vals[bigI]/total*100)}%`,`✅ ${Math.round(vals[bigI]/total*100)}%`]};
}
function genSimpleProb(){
  const total=rnd(6,20),fav=rnd(1,total-1),[sn,sd]=simp(fav,total);
  return{q:`A bag has ${total} marbles, ${fav} are red.\nWhat is P(red) as a fraction in simplest form?`,a:FR(sn,sd),steps:[`P(red)=${fav}/${total}`,`GCD=${gcd(fav,total)} → ${FR(sn,sd)}`,`✅ ${FR(sn,sd)}`]};
}
function genExpectedFreq(){
  const sec=rnd(4,8),fav=rnd(1,sec-1),trials=rnd(2,10)*sec*rnd(2,5),exp=(fav/sec)*trials;
  return{q:`Spinner: ${sec} equal sections, ${fav} are red.\nIf spun ${trials} times, how many times would you expect red?`,a:`${exp}`,steps:[`P(red)=${fav}/${sec}`,`Expected=${fav}/${sec}×${trials}=${fav*trials}/${sec}=${exp}`,`✅ ${exp} times`]};
}
function genComplementary(){
  const total=rnd(8,24),r=rnd(1,total-3),b=rnd(1,total-r-1),g=total-r-b,[rn,rd]=simp(r,total),[nn,nd]=simp(total-r,total);
  return{q:`Bag: ${r} red, ${b} blue, ${g} green (${total} total).\nWhat is P(NOT red) as a fraction in simplest form?`,a:FR(nn,nd),steps:[`Not red = ${b}+${g}=${total-r}`,`P(not red)=${total-r}/${total}`,`GCD=${gcd(total-r,total)} → ${FR(nn,nd)}`,`✅ ${FR(nn,nd)}`]};
}

// ═══════════════════════════════════════════════════════
//  RENDERING
// ═══════════════════════════════════════════════════════
function render(html){
  const app=$('app');
  app.innerHTML=html;
  app.classList.remove('fade-up');
  void app.offsetWidth;
  app.classList.add('fade-up');
}

function setStrandCSSVars(strand){
  const r=document.documentElement;
  if(!strand){r.style.removeProperty('--strand-color');r.style.removeProperty('--strand-accent');r.style.removeProperty('--strand-bg');r.style.removeProperty('--strand-color-faint');return;}
  r.style.setProperty('--strand-color', strand.color);
  r.style.setProperty('--strand-accent', strand.accent);
  r.style.setProperty('--strand-bg', strand.bg);
  r.style.setProperty('--strand-color-faint', strand.color+'44');
}

function updateNav(){
  ['nc1','nc2','nc3','nc4'].forEach(id=>$(id).style.display='none');
  if(!SEL_STRAND) return;
  $('nc1').style.display=$('nc2').style.display='inline';
  $('nc2').textContent=SEL_STRAND.emoji+' '+SEL_STRAND.label;
  $('nc2').style.color=SEL_STRAND.accent;
  if(SEL_TOPIC){
    $('nc3').style.display=$('nc4').style.display='inline';
    $('nc4').textContent=SEL_TOPIC.label;
    $('nc4').style.color='#888';
  }
}

// ── DASHBOARD ─────────────────────────────────────────────
function showDashboard(){
  VIEW='dashboard'; SEL_STRAND=SEL_SUBSTRAND=SEL_TOPIC=null;
  Q_NUM=1; STREAK=CORRECT=0;
  setStrandCSSVars(null); updateNav();
  const cards=Object.entries(ACTIVE_CURRICULUM).map(([k,s])=>{
    const tc=Object.values(s.subStrands).flatMap(ss=>Object.keys(ss.topics)).length;
    return `<button class="strand-card" onclick="showStrand('${k}')"
      style="border-color:${s.color};box-shadow:0 4px 18px ${s.color}33"
      onmouseenter="this.style.boxShadow='0 16px 40px ${s.color}55'"
      onmouseleave="this.style.boxShadow='0 4px 18px ${s.color}33'">
      <span class="card-emoji">${s.emoji}</span>
      <div class="card-title">${s.label}</div>
      <div class="card-sub">${tc} topic${tc!==1?'s':''} · Unlimited dynamic questions</div>
      <span class="card-btn" style="background:${s.bg};border-color:${s.color}44;color:${s.accent}">Explore →</span>
    </button>`;
  }).join('');
  render(`
    <div id="hero">
      <span class="hero-kicker">QUEENSLAND MATHEMATICS</span>
      <h1>Maths Master Snr <span>${CURRENT_YEAR}</span></h1>
      <p class="sub">Focused practice aligned to Queensland curriculum pathways</p>
      <p class="sub2">Build fluency, review methods and prepare for assessment.</p>
    </div>
    ${buildSeniorCommandBar()}
    <h2 class="section-heading">Course content</h2>
    <div class="strand-grid">${cards}</div>
    <div class="how-box">
      <h3>Study workflow</h3>
      <div class="how-grid">
        <div><div class="how-item-title">Select a course area</div><div class="how-item-desc">Choose the concept you need to strengthen</div></div>
        <div><div class="how-item-title">Develop your solution</div><div class="how-item-desc">Use the workspace and record clear mathematical working</div></div>
        <div><div class="how-item-title">Check your response</div><div class="how-item-desc">Receive immediate feedback in Study mode</div></div>
        <div><div class="how-item-title">Review the method</div><div class="how-item-desc">Compare your approach with a structured solution</div></div>
      </div>
    </div>`);
}

// ── STRAND PICKER ─────────────────────────────────────────
function showStrand(k){
  VIEW='strand'; SEL_STRAND=ACTIVE_CURRICULUM[k]; SEL_STRAND._key=k;
  SEL_TOPIC=SEL_SUBSTRAND=null;
  setStrandCSSVars(SEL_STRAND); updateNav();
  const {color,accent,bg,emoji,label,subStrands}=SEL_STRAND;
  const sections=Object.entries(subStrands).map(([ssK,ss])=>`
    <div class="sub-strand-label" style="color:${accent}">${ss.emoji} ${ss.label}</div>
    <div class="topic-list">${Object.entries(ss.topics).map(([tK,t])=>`
      <button class="topic-row" onclick="showTopic('${ssK}','${tK}')"
        onmouseenter="this.style.borderColor='${color}';this.style.boxShadow='0 4px 20px ${color}33'"
        onmouseleave="this.style.borderColor='#f0f0f0';this.style.boxShadow='0 2px 10px rgba(0,0,0,.04)'">
        <div>
          <div class="topic-row-title">${t.label}</div>
          <div class="topic-row-code">${t.acCode} · 25 dynamic questions</div>
        </div>
        <span class="topic-start-btn" style="background:${bg};border-color:${color}44;color:${accent}">Start →</span>
      </button>`).join('')}</div>`).join('');
  render(`
    <div class="page-header">
      <button class="back-btn" onclick="showDashboard()" style="border-color:${color}44;color:${accent}">← Back</button>
      <h2 class="page-title">${emoji} ${label}</h2>
      <p class="page-subtitle">Choose a specific topic to practise</p>
    </div>${sections}`);
}

// ── QUESTION SESSION ──────────────────────────────────────
function showTopic(ssK,tK){
  VIEW='topic';
  const ss=SEL_STRAND.subStrands[ssK];
  SEL_SUBSTRAND=ss; SEL_TOPIC=ss.topics[tK];
  SEL_TOPIC._ssKey=ssK; SEL_TOPIC._tKey=tK;
  Q_NUM=1; STREAK=CORRECT=0;
  setStrandCSSVars(SEL_STRAND); updateNav();
  renderQuestion();
}

function renderQuestion(){
  MAX_ATTEMPTS=SNR_MODE==='exam'?1:3;
  CUR_Q=SEL_TOPIC.gen();
  STEPS_SHOWN=0; WORKING_SHOWN=false; MARKED=null; ATTEMPTS=0;
  const {color,accent,bg}=SEL_STRAND;
  const pct=Math.round((Q_NUM/TOTAL_Q)*100);

  render(`
    <div class="page-header" style="padding-top:18px;margin-bottom:12px">
      <button class="back-btn" onclick="showStrand('${SEL_STRAND._key}')" style="border-color:${color}44;color:${accent}">← Topics</button>
      <h2 style="font-weight:900;font-size:21px;margin-bottom:3px">${SEL_SUBSTRAND.emoji} ${SEL_TOPIC.label}</h2>
      <p style="font-size:12px;color:#888">${SEL_STRAND.label} · ${SEL_TOPIC.acCode} · ${TOTAL_Q} questions per session</p>
    </div>

    <div class="score-strip">
      <div class="score-box" style="border-color:${color}33"><div class="score-val" style="color:#52c41a">${CORRECT}</div><div class="score-lbl">✅ Correct</div></div>
      <div class="score-box" style="border-color:${color}33"><div class="score-val" style="color:${color}">${Q_NUM}/${TOTAL_Q}</div><div class="score-lbl">🔢 Question</div></div>
      <div class="score-box" style="border-color:${color}33"><div class="score-val" style="color:#FF6B6B">${STREAK}</div><div class="score-lbl">🔥 Streak</div></div>
    </div>

    <div class="progress-bar-wrap">
      <div class="progress-bar-labels">
        <span>Progress</span>
        ${STREAK>=2?`<span class="streak-badge">🔥 ${STREAK} in a row!</span>`:''}
      </div>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%;background:linear-gradient(90deg,${color},${accent})"></div></div>
    </div>

    <div style="margin-bottom:10px">
      <span class="meta-badge" style="background:${bg};border-color:${color}44;color:${accent}">${SEL_TOPIC.acCode} · Queensland ${CURRENT_YEAR}</span>
      <span class="meta-badge" style="background:#f8f8f8;border-color:#eee;color:#aaa">⭐⭐⭐ Core practice</span>
    </div>

    <!-- QUESTION -->
    <div class="q-card" style="border-color:${color}22">
      <p class="q-text">${CUR_Q.q}</p>
    </div>

    <!-- ANSWER CHECK RESULT (hidden initially) -->
    <div id="check-result" style="display:none"></div>

    <!-- WORKSPACE -->
    ${buildWorkspace()}

    <!-- CHECK ANSWER BUTTON -->
    <div id="check-btn-wrap">
      <button class="check-btn" id="check-btn" onclick="doCheckAnswer()">
        ✅ Check My Answer
      </button>
    </div>

    <!-- SECONDARY BUTTONS -->
    <div class="btn-row" id="secondary-btns">
      <button class="btn btn-outline" id="btn-working"
        style="border-color:${color};color:${accent}"
        onmouseenter="this.style.background='${bg}'" onmouseleave="this.style.background='white'"
        onclick="revealWorking()">Review the method</button>
      <button class="btn btn-gray" onclick="renderQuestion()">🔄 New Question</button>
    </div>

    <!-- WORKING REVEAL -->
    <div id="working-area"></div>

    <!-- NEXT BUTTON -->
    <div id="next-btn-area"></div>
  `);

  initWorkspace();
  // Auto-focus the type answer box
  setTimeout(()=>{ const ta=$('type-answer'); if(ta){ ta.focus(); }}, 150);
}

// ═══════════════════════════════════════════════════════
//  CHECK ANSWER LOGIC
// ═══════════════════════════════════════════════════════
function doCheckAnswer(){
  const typeInput = $('type-answer');
  const studentRaw = typeInput ? typeInput.value.trim() : '';

  if(!studentRaw){
    // Bounce the input to signal "please type something"
    const ws=$('workspace');
    if(ws){ws.classList.add('shake');setTimeout(()=>ws.classList.remove('shake'),450);}
    // Switch to type tab if not there
    setWsMode('type');
    setTimeout(()=>{ const ta=$('type-answer'); if(ta) ta.focus(); },100);
    showCheckResult({correct:false,partial:false,feedback:'empty',hint:'Please type your answer in the "Type Answer" tab above, then check it!'}, studentRaw);
    return;
  }

  ATTEMPTS++;
  const result = checkMultiPart(studentRaw, CUR_Q.a);

  if(result.correct){
    MARKED='correct'; STREAK++; CORRECT++;
    // Flash the input green
    if(typeInput){typeInput.classList.add('input-correct');typeInput.disabled=true;}
    // Disable check button
    const cb=$('check-btn'); if(cb){cb.disabled=true;}
    // Celebration
    const emojis=['⭐','🌟','🔥','🏆','💪','🎯','✨','🎉'];
    const em=emojis[Math.floor(Math.random()*emojis.length)];
    const cel=$('celebration'); cel.textContent=em; cel.classList.add('active');
    setTimeout(()=>cel.classList.remove('active'),1800);
    showCheckResult(result, studentRaw);
    showNextBtn();
  } else if(ATTEMPTS >= MAX_ATTEMPTS){
    // Out of tries — reveal answer
    MARKED='wrong'; STREAK=0;
    if(typeInput){typeInput.classList.add('input-wrong');typeInput.disabled=true;}
    const cb=$('check-btn'); if(cb){cb.disabled=true;}
    showCheckResult({...result, outOfAttempts:true, correctAnswer:CUR_Q.a}, studentRaw);
    showNextBtn();
  } else {
    // Wrong but still has tries
    if(typeInput){
      typeInput.classList.remove('input-correct','input-wrong','input-partial');
      typeInput.classList.add(result.partial?'input-partial':'input-wrong');
      void typeInput.offsetWidth;
      // Flash & clear class after a moment
      setTimeout(()=>{
        if(typeInput){
          typeInput.classList.remove('input-wrong','input-partial');
        }
      },1500);
    }
    showCheckResult(result, studentRaw);
  }
}

function showCheckResult(result, studentRaw){
  const el=$('check-result');
  if(!el) return;
  el.style.display='block';

  const attemptsLeft = MAX_ATTEMPTS - ATTEMPTS;

  if(result.feedback==='empty'){
    el.className='result-wrong';
    el.innerHTML=`<div class="result-inner">
      <div class="result-header">
        <span class="result-icon">✏️</span>
        <div><div class="result-title" style="color:#d46b08">Type your answer first!</div></div>
      </div>
      <div class="result-hint">${result.hint}</div>
    </div>`;
    el.classList.add('fade-up');
    return;
  }

  if(result.correct){
    const streakMsg = STREAK>=5?`<br>🔥 ${STREAK} in a row — you're on fire!`:STREAK>=3?`<br>🔥 ${STREAK} streak — keep going!`:'';
    el.className='result-correct fade-up';
    el.innerHTML=`<div class="result-inner">
      <div class="result-header">
        <span class="result-icon">${STREAK>=3?'🏆':'🌟'}</span>
        <div>
          <div class="result-title" style="color:#237804">${STREAK>=5?'OUTSTANDING!':STREAK>=3?'BRILLIANT!':'Correct! Well done!'}</div>
          <div class="result-subtitle" style="color:#389e0d">That's exactly right!${streakMsg}</div>
        </div>
      </div>
      <div class="result-divider"></div>
      <div class="result-row">
        <span class="result-label">Your answer:</span>
        <span class="result-value" style="color:#237804">✓ ${studentRaw}</span>
      </div>
      <div class="result-row">
        <span class="result-label">Correct answer:</span>
        <span class="result-value result-correct-ans">${CUR_Q.a}</span>
      </div>
      ${ATTEMPTS>1?`<div class="result-attempts">You got it in ${ATTEMPTS} attempt${ATTEMPTS!==1?'s':''}!</div>`:''}
    </div>`;
  } else if(result.outOfAttempts){
    el.className='result-wrong fade-up';
    el.innerHTML=`<div class="result-inner">
      <div class="result-header">
        <span class="result-icon">💪</span>
        <div>
          <div class="result-title" style="color:#a8071a">Not quite — keep practising!</div>
          <div class="result-subtitle" style="color:#cf1322">You've used all ${MAX_ATTEMPTS} attempts. Here's the answer:</div>
        </div>
      </div>
      <div class="result-divider"></div>
      <div class="result-row">
        <span class="result-label">Your answer:</span>
        <span class="result-value" style="color:#cf1322">✗ ${studentRaw}</span>
      </div>
      <div class="result-row">
        <span class="result-label">Correct answer:</span>
        <span class="result-value result-correct-ans">${CUR_Q.a}</span>
      </div>
      <div class="result-hint">Review the step-by-step working below to understand the method. You'll get it next time! 🌟</div>
    </div>`;
    // Auto-open working
    revealWorking();
  } else if(result.partial){
    el.className='result-partial fade-up';
    el.innerHTML=`<div class="result-inner">
      <div class="result-header">
        <span class="result-icon">🤏</span>
        <div>
          <div class="result-title" style="color:#ad6800">Almost there!</div>
          <div class="result-subtitle" style="color:#d48806">You're on the right track — ${attemptsLeft} attempt${attemptsLeft!==1?'s':''} left</div>
        </div>
      </div>
      <div class="result-divider"></div>
      <div class="result-row">
        <span class="result-label">Your answer:</span>
        <span class="result-value" style="color:#d48806">~ ${studentRaw}</span>
      </div>
      ${result.hint?`<div class="result-hint">💡 ${result.hint}</div>`:''}
    </div>`;
  } else {
    el.className='result-wrong fade-up';
    const encouragements=[
      "Give it another go — you can do this!",
      "Not quite — double-check your working.",
      "Keep trying! Look at the question carefully.",
      "Have another look — re-read the question.",
    ];
    const enc=encouragements[Math.floor(Math.random()*encouragements.length)];
    el.innerHTML=`<div class="result-inner">
      <div class="result-header">
        <span class="result-icon">🔄</span>
        <div>
          <div class="result-title" style="color:#a8071a">Not quite right</div>
          <div class="result-subtitle" style="color:#cf1322">${attemptsLeft} attempt${attemptsLeft!==1?'s':''} remaining</div>
        </div>
      </div>
      <div class="result-divider"></div>
      <div class="result-row">
        <span class="result-label">Your answer:</span>
        <span class="result-value" style="color:#cf1322">✗ ${studentRaw}</span>
      </div>
      ${result.hint?`<div class="result-hint">💡 ${result.hint}</div>`:'<div class="result-hint">'+enc+'</div>'}
    </div>`;
  }

  el.scrollIntoView({behavior:'smooth',block:'nearest'});
}

function showNextBtn(){
  const {color,accent}=SEL_STRAND;
  $('next-btn-area').innerHTML=`
    <button class="btn btn-next fade-up" onclick="nextQuestion()"
      style="background:linear-gradient(135deg,${color},${accent});border-radius:14px;padding:16px;font-size:17px;font-weight:900;border:none;cursor:pointer;font-family:inherit;color:white;display:block;width:100%;margin-top:12px;transition:transform .2s;"
      onmouseenter="this.style.transform='scale(1.01)'"
      onmouseleave="this.style.transform='scale(1)'">
      ${Q_NUM>=TOTAL_Q?'🎉 Finish Session':'Next Question →'}
    </button>`;
}

// ═══════════════════════════════════════════════════════
//  WORKING REVEAL
// ═══════════════════════════════════════════════════════
function revealWorking(){
  if(WORKING_SHOWN) return;
  WORKING_SHOWN=true; STEPS_SHOWN=0;
  const {color,accent,bg}=SEL_STRAND;
  // Hide the show working button
  const bw=$('btn-working'); if(bw) bw.style.display='none';
  $('working-area').innerHTML=`
    <div class="working-box fade-up" style="background:${bg};border-color:${color}44">
      <div class="working-label" style="color:${accent}">🧩 STEP-BY-STEP WORKING</div>
      <div class="step-list" id="step-list"></div>
      <button class="step-reveal-btn" id="step-btn"
        style="background:linear-gradient(135deg,${color},${accent})"
        onclick="revealStep()">👣 Show First Step</button>
    </div>`;
}

function revealStep(){
  const list=$('step-list'); if(!list) return;
  const step=CUR_Q.steps[STEPS_SHOWN]; if(step===undefined) return;
  const {color,accent}=SEL_STRAND;
  const d=document.createElement('div');
  d.className='step-item slide-right';
  d.style.borderLeftColor=color;
  d.innerHTML=`<span class="step-num" style="color:${accent}">Step ${STEPS_SHOWN+1}: </span>${step}`;
  list.appendChild(d);
  STEPS_SHOWN++;
  const btn=$('step-btn');
  if(btn){
    if(STEPS_SHOWN>=CUR_Q.steps.length){
      btn.outerHTML='<div class="steps-done">🎉 All steps shown! Now you know how to do it!</div>';
    } else {
      btn.textContent=`➡️ Next Step (${STEPS_SHOWN+1}/${CUR_Q.steps.length})`;
    }
  }
}

function nextQuestion(){
  if(Q_NUM>=TOTAL_Q){showSessionEnd();return;}
  Q_NUM++;renderQuestion();
}

function showSessionEnd(){
  const {color,accent,bg,emoji,label}=SEL_STRAND;
  const pct=Math.round((CORRECT/TOTAL_Q)*100);
  const grade=pct>=90?'A+':pct>=80?'A':pct>=70?'B':pct>=60?'C':'Keep Practising!';
  const msg=pct>=90?'Outstanding! You\'re absolutely smashing it! 🏆':pct>=80?'Excellent! Well on track for an A! ⭐':pct>=70?'Great effort! Keep pushing! 💪':'Good start! Review the step-by-step working and try again. You\'ve got this! 🌟';
  render(`
    <div class="end-card">
      <div style="font-size:68px;margin-bottom:14px">🎓</div>
      <h2 style="font-weight:900;font-size:32px;color:#1a1a2e;margin-bottom:6px">Session Complete!</h2>
      <p style="font-size:16px;color:#888;margin-bottom:26px">${emoji} ${label}</p>
      <div style="background:white;border-radius:22px;padding:30px;box-shadow:0 8px 40px rgba(0,0,0,.08);max-width:400px;margin:0 auto 26px">
        <div style="font-size:58px;font-weight:900;color:${color};margin-bottom:4px">${CORRECT}/${TOTAL_Q}</div>
        <div style="font-size:20px;font-weight:800;color:#1a1a2e;margin-bottom:8px">Grade: ${grade}</div>
        <div style="background:#f0f0f0;border-radius:20px;height:12px;overflow:hidden;margin-bottom:14px">
          <div style="width:${pct}%;height:100%;background:linear-gradient(90deg,${color},${accent});border-radius:20px"></div>
        </div>
        <p style="font-size:15px;font-weight:700;color:#555;line-height:1.6">${msg}</p>
      </div>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
        <button class="check-btn" style="flex:0 1 auto;width:auto;padding:14px 24px;font-size:16px" onclick="showTopic('${SEL_TOPIC._ssKey}','${SEL_TOPIC._tKey}')">🔄 Try Again</button>
        <button class="btn btn-outline" style="border:3px solid ${color};color:${accent};flex:0 1 auto;background:white" onclick="showStrand('${SEL_STRAND._key}')">📚 Other Topics</button>
        <button class="btn btn-gray" onclick="showDashboard()">🏠 Home</button>
      </div>
    </div>`);
  setTimeout(()=>showBonusNotification('topic',pct),300);
}

// ═══════════════════════════════════════════════════════
//  WORKSPACE
// ═══════════════════════════════════════════════════════
function buildWorkspace(){
  const {color,accent,bg}=SEL_STRAND;
  return `
  <div id="workspace" style="border-color:${color}22;margin-bottom:12px">
    <div id="workspace-header">
      <button class="ws-tab" id="tab-type" onclick="setWsMode('type')">⌨️ Type Answer</button>
      <button class="ws-tab" id="tab-draw" onclick="setWsMode('draw')">✏️ Draw / Touch</button>
      <button class="ws-tab" id="tab-scratch" onclick="setWsMode('scratch')">📝 Scratchpad</button>
    </div>

    <!-- Draw toolbar (shown only in draw mode) -->
    <div id="ws-toolbar" style="display:none">
      <button class="tool-btn t-active" id="tool-pen" onclick="setTool('pen')"
        style="background:${color};color:white;border-color:${color}">✏️ Pen</button>
      <button class="tool-btn" id="tool-highlighter" onclick="setTool('highlighter')">🖍 Highlight</button>
      <button class="tool-btn" id="tool-line" onclick="setTool('line')">📏 Line</button>
      <button class="tool-btn" id="tool-eraser" onclick="setTool('eraser')">🧹 Eraser</button>
      <div style="width:1px;height:22px;background:#e0e0e0;margin:0 3px"></div>
      ${[['#1a1a2e','Dark'],['#CC2200','Red'],['#1A8A82','Teal'],['#5A4FCF','Purple'],['#B8860B','Gold'],['#237804','Green']].map(([c,nm])=>
        `<div class="swatch ${c==='#1a1a2e'?'active':''}" style="background:${c}" data-color="${c}" onclick="setColor('${c}')" title="${nm}"></div>`).join('')}
      <div style="width:1px;height:22px;background:#e0e0e0;margin:0 3px"></div>
      <div class="size-dot active" data-size="2" onclick="setSize(2)" style="width:10px;height:10px" title="Fine"></div>
      <div class="size-dot" data-size="4" onclick="setSize(4)" style="width:16px;height:16px" title="Medium"></div>
      <div class="size-dot" data-size="8" onclick="setSize(8)" style="width:22px;height:22px" title="Thick"></div>
      <div style="flex:1"></div>
      <button class="tool-btn" onclick="clearCanvas()">🗑️ Clear</button>
    </div>

    <!-- TYPE PANEL (default active) -->
    <div id="type-panel" class="active">
      <div id="answer-input-label">
        <span>YOUR ANSWER — type it here, then click Check My Answer</span>
        <span id="attempts-indicator">${MAX_ATTEMPTS} attempts allowed</span>
      </div>
      <div id="answer-input-wrap">
        <textarea id="type-answer"
          placeholder="Type your answer here… e.g.  3/4  or  2 1/2  or  $15.60"
          rows="2"
          oninput="autoResize(this)"
          onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();doCheckAnswer();}"></textarea>
      </div>
      <div class="sym-row-label">Quick symbols</div>
      <div class="sym-grid">
        ${['½','⅓','¼','⅔','¾','⅛','×','÷','−','±','√','²','³','°','≤','≥','≠','≈','∞','π'].map(s=>
          `<button class="sym-btn" onclick="insertSym('type-answer','${s}')">${s}</button>`).join('')}
        <button class="sym-btn" onclick="insertFrac('type-answer')" style="min-width:52px;font-size:13px">a/b</button>
      </div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="tool-btn" style="flex:1" onclick="clearType()">🗑️ Clear answer</button>
      </div>
    </div>

    <!-- DRAW PANEL -->
    <div id="draw-panel">
      <div id="canvas-wrap"><canvas id="drawing-canvas" height="280"></canvas></div>
      <div style="padding:5px 12px 7px;font-size:11px;color:#bbb;font-weight:700;background:#fafafa;border-top:1px solid #f0f0f0">
        ✏️ Draw with finger, stylus or mouse — then switch to Type Answer to check
      </div>
    </div>

    <!-- SCRATCH PANEL -->
    <div id="scratch-panel">
      <label style="font-size:12px;font-weight:800;color:#888;margin-bottom:8px;display:block">WORKING OUT SPACE — show all your steps here</label>
      <textarea id="scratch-area" rows="6"
        placeholder="Show all your working here step by step…&#10;e.g.  7 × 8 = 56&#10;     56 ÷ 4 = 14"
        oninput="autoResize(this)"></textarea>
      <div class="scratch-sym-grid">
        ${['½','⅓','¼','⅔','¾','×','÷','−','±','√','²','³','°','≤','≥','≠','≈','∴','∵'].map(s=>
          `<button class="sym-btn" onclick="insertSym('scratch-area','${s}')">${s}</button>`).join('')}
        <button class="sym-btn" onclick="insertFrac('scratch-area')" style="min-width:52px;font-size:13px">a/b</button>
        <button class="sym-btn" onclick="insertTemplate('scratch-area','long_div')" style="font-size:12px;min-width:68px">Long ÷</button>
        <button class="sym-btn" onclick="insertTemplate('scratch-area','col_add')" style="font-size:12px;min-width:68px">Col +</button>
      </div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="tool-btn" style="flex:1" onclick="clearScratch()">🗑️ Clear scratchpad</button>
      </div>
    </div>
  </div>`;
}

function initWorkspace(){
  setWsMode(wsMode);
  canvas=$('drawing-canvas');
  if(!canvas) return;
  resizeCanvas();
  ctx=canvas.getContext('2d');
  ctx.lineCap='round';ctx.lineJoin='round';
  ctx.strokeStyle=drawColor;ctx.lineWidth=drawSize;
  canvas.addEventListener('mousedown',startDraw);
  canvas.addEventListener('mousemove',draw);
  canvas.addEventListener('mouseup',endDraw);
  canvas.addEventListener('mouseleave',endDraw);
  canvas.addEventListener('touchstart',e=>{e.preventDefault();startDraw(e.touches[0]);},{passive:false});
  canvas.addEventListener('touchmove',e=>{e.preventDefault();draw(e.touches[0]);},{passive:false});
  canvas.addEventListener('touchend',e=>{e.preventDefault();endDraw();},{passive:false});
  const ro=new ResizeObserver(resizeCanvas);
  ro.observe(canvas.parentElement);
}

function resizeCanvas(){
  if(!canvas) return;
  const wrap=$('canvas-wrap'); if(!wrap) return;
  const w=wrap.clientWidth||window.innerWidth-32;
  const old=canvas.toDataURL();
  canvas.width=w;
  canvas.height=Math.max(240,Math.round(w*0.42));
  const img=new Image();
  img.onload=()=>{if(ctx)ctx.drawImage(img,0,0);};
  img.src=old;
  if(ctx){ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle=drawColor;ctx.lineWidth=drawSize;}
}

function getPos(e){
  const rect=canvas.getBoundingClientRect();
  const sx=canvas.width/rect.width, sy=canvas.height/rect.height;
  return{x:(e.clientX-rect.left)*sx, y:(e.clientY-rect.top)*sy};
}
function startDraw(e){
  isDrawing=true;
  const p=getPos(e); lastX=p.x;lastY=p.y;
  if(drawTool==='line'){startX=p.x;startY=p.y;canvasSnapshot=ctx.getImageData(0,0,canvas.width,canvas.height);}
  ctx.beginPath();ctx.moveTo(p.x,p.y);
}
function draw(e){
  if(!isDrawing) return;
  const p=getPos(e);
  if(drawTool==='eraser'){
    ctx.save();ctx.globalCompositeOperation='destination-out';
    ctx.beginPath();ctx.arc(p.x,p.y,drawSize*3,0,Math.PI*2);ctx.fill();ctx.restore();
  } else if(drawTool==='line'){
    ctx.putImageData(canvasSnapshot,0,0);
    ctx.beginPath();ctx.moveTo(startX,startY);ctx.lineTo(p.x,p.y);ctx.stroke();
  } else {
    if(drawTool==='highlighter'){ctx.save();ctx.globalAlpha=0.3;ctx.lineWidth=drawSize*5;}
    ctx.lineTo(p.x,p.y);ctx.stroke();
    ctx.beginPath();ctx.moveTo(p.x,p.y);
    if(drawTool==='highlighter'){ctx.restore();applyTool();}
  }
  lastX=p.x;lastY=p.y;
}
function endDraw(){isDrawing=false;ctx&&ctx.beginPath();}
function clearCanvas(){if(ctx&&canvas)ctx.clearRect(0,0,canvas.width,canvas.height);}

function setWsMode(mode){
  wsMode=mode;
  ['draw','type','scratch'].forEach(m=>{
    const tab=$(`tab-${m}`);
    const panel=$(`${m}-panel`);
    if(tab) tab.classList.toggle('active',m===mode);
    if(panel){
      panel.style.display=m===mode?'flex':'none';
      if(m===mode) panel.style.flexDirection='column';
    }
  });
  const tb=$('ws-toolbar');
  if(tb) tb.style.display=mode==='draw'?'flex':'none';
  // Apply correct underline colour
  if(SEL_STRAND){
    document.querySelectorAll('.ws-tab').forEach(t=>{
      if(t.classList.contains('active')){
        t.style.borderBottomColor=SEL_STRAND.color;
        t.style.color=SEL_STRAND.accent;
      } else {
        t.style.borderBottomColor='transparent';
        t.style.color='#999';
      }
    });
  }
}

function setTool(t){
  drawTool=t;
  document.querySelectorAll('.tool-btn[id^="tool-"]').forEach(b=>{
    b.classList.remove('t-active');
    b.style.background='white';b.style.color='#555';b.style.borderColor='#e8e8e8';
  });
  const btn=$(`tool-${t}`);
  if(btn&&SEL_STRAND){
    btn.classList.add('t-active');
    btn.style.background=SEL_STRAND.color;
    btn.style.color='white';
    btn.style.borderColor=SEL_STRAND.color;
  }
  applyTool();
}
function applyTool(){
  if(!ctx||!canvas) return;
  ctx.globalCompositeOperation='source-over';ctx.globalAlpha=1;
  ctx.strokeStyle=drawTool==='eraser'?'rgba(0,0,0,1)':drawColor;
  ctx.lineWidth=drawTool==='highlighter'?drawSize*5:drawTool==='eraser'?drawSize*3:drawSize;
}
function setColor(c){
  drawColor=c;
  if(drawTool==='eraser') setTool('pen');
  document.querySelectorAll('.swatch').forEach(s=>s.classList.toggle('active',s.dataset.color===c));
  applyTool();
}
function setSize(s){
  drawSize=s;
  document.querySelectorAll('.size-dot').forEach(d=>d.classList.toggle('active',+d.dataset.size===s));
  applyTool();
}
function insertSym(id,sym){
  const el=$(id);if(!el)return;
  const s=el.selectionStart,e=el.selectionEnd;
  el.value=el.value.slice(0,s)+sym+el.value.slice(e);
  el.selectionStart=el.selectionEnd=s+sym.length;
  el.focus();autoResize(el);
}
function insertFrac(id){insertSym(id,'□/□');}
function insertTemplate(id,type){
  let tmpl='';
  if(type==='long_div') tmpl='\n  _________\n□ ) □□□□□\n';
  if(type==='col_add') tmpl='\n    □□□\n  + □□□\n  -----\n';
  insertSym(id,tmpl);
}
function autoResize(el){el.style.height='auto';el.style.height=el.scrollHeight+'px';}
function clearType(){
  const el=$('type-answer');
  if(el){el.value='';el.style.height='auto';el.className='';el.disabled=false;el.focus();}
  // Re-enable check button
  const cb=$('check-btn');if(cb)cb.disabled=false;
  // Hide result
  const cr=$('check-result');if(cr)cr.style.display='none';
  ATTEMPTS=0; MARKED=null;
}
function clearScratch(){const el=$('scratch-area');if(el){el.value='';el.style.height='auto';}}

function goHome(){showDashboard();}
function goStrand(){if(SEL_STRAND)showStrand(SEL_STRAND._key);}

// ═══════════════════════════════════════════════════════
//  TIMES TABLES MODULE
//  QLD Curriculum: Year 6 students expected to recall
//  multiplication facts to 10×10 fluently within ~3s each.
//  Standard timed test: 50 questions in 5 minutes (6s avg).
//  We use 20 questions in 3 minutes for a focused session.
// ═══════════════════════════════════════════════════════
const TT = {
  selectedTables: new Set([2,3,4,5,6,7,8,9,10]),
  questions: [],
  current: 0,
  correct: 0,
  wrong: 0,
  missed: [],        // [{q,correct,given}]
  timeLimit: 180,    // 3 minutes = 180 seconds (QLD: ~6s per fact)
  totalQ: 20,
  timeLeft: 180,
  timerInterval: null,
  highScore: parseInt(localStorage.getItem('tt_high')||'0'),
  testStartTime: 0,
  totalTime: 0,
};

function showTimesTablesHub(){
  VIEW='tt-hub';
  setStrandCSSVars(null); updateNav();
  // Clear nav crumbs
  ['nc1','nc2','nc3','nc4'].forEach(id=>$(id).style.display='none');

  const tableBtns = Array.from({length:10},(_,i)=>i+1).map(n=>`
    <button class="tt-cell ${TT.selectedTables.has(n)?'selected':''}"
      onclick="ttToggleTable(${n})" id="tt-cell-${n}">${n}</button>
  `).join('');

  render(`
    <div class="tt-hero">
      <span class="tt-hero-icon">✖️</span>
      <h2>Times Tables Trainer</h2>
      <p>Queensland Year 6 · AC9M6N · Fluency with facts to 10×10</p>
    </div>

    <div class="tt-selector-wrap">
      <div class="tt-selector-title">🎯 Choose your times tables</div>
      <div class="tt-grid">${tableBtns}</div>
      <div class="tt-quick-btns">
        <button class="tt-quick-btn" onclick="ttSelectAll()">✅ Select All</button>
        <button class="tt-quick-btn" onclick="ttSelectNone()">❌ Clear All</button>
        <button class="tt-quick-btn" onclick="ttSelectHard()">🔥 Hard ones (6–9)</button>
        <button class="tt-quick-btn" onclick="ttSelectEasy()">⭐ Easy ones (2–5, 10)</button>
      </div>
    </div>

    <div class="tt-settings">
      <div class="tt-setting-box">
        <div class="tt-setting-label">⏱ Time Limit</div>
        <div class="tt-stat-val" style="font-size:22px;font-weight:900;color:#7c3aed">3:00</div>
        <div class="tt-setting-sub">Queensland test standard<br>~9s per question</div>
      </div>
      <div class="tt-setting-box">
        <div class="tt-setting-label">🔢 Questions</div>
        <div class="tt-stat-val" style="font-size:22px;font-weight:900;color:#7c3aed">20</div>
        <div class="tt-setting-sub">Randomised from<br>your selected tables</div>
      </div>
      <div class="tt-setting-box">
        <div class="tt-setting-label">🏆 Your Best</div>
        <div class="tt-stat-val" style="font-size:22px;font-weight:900;color:#7c3aed">${TT.highScore}/20</div>
        <div class="tt-setting-sub">Score 18+ (90%)<br>to unlock Snake! 🐍</div>
      </div>
    </div>

    <button class="tt-start-btn" id="tt-start-btn" onclick="ttStartTest()">
      🚀 Start Timed Test!
    </button>

    <div style="margin-top:16px;background:linear-gradient(135deg,#f5f3ff,#ede9fe);border:2px solid #c4b5fd;border-radius:16px;padding:16px 18px;">
      <div style="font-weight:800;font-size:14px;color:#7c3aed;margin-bottom:6px">📋 How the Times Tables Test Works</div>
      <div style="font-size:13px;color:#6c6c8a;line-height:1.7;font-weight:600">
        • 20 random multiplication questions from your chosen tables<br>
        • You have <strong>3 minutes</strong> (based on QLD curriculum fluency standards — approx. 9 seconds per question)<br>
        • Type your answer and press <strong>Enter</strong> or tap the arrow to move to the next question<br>
        • Score <strong>90% or more (18/20)</strong> to unlock a round of classic Snake! 🐍<br>
        • After the test, review any questions you missed
      </div>
    </div>

    <button class="tt-btn tt-btn-home" onclick="showDashboard()" style="margin-top:14px;width:100%">← Back to Dashboard</button>
  `);
  updateStartBtn();
}

function ttToggleTable(n){
  if(TT.selectedTables.has(n)) TT.selectedTables.delete(n);
  else TT.selectedTables.add(n);
  const cell=$(`tt-cell-${n}`);
  if(cell) cell.classList.toggle('selected', TT.selectedTables.has(n));
  updateStartBtn();
}
function ttSelectAll(){ for(let i=1;i<=10;i++) TT.selectedTables.add(i); refreshCells(); updateStartBtn(); }
function ttSelectNone(){ TT.selectedTables.clear(); refreshCells(); updateStartBtn(); }
function ttSelectHard(){ TT.selectedTables.clear(); [6,7,8,9].forEach(n=>TT.selectedTables.add(n)); refreshCells(); updateStartBtn(); }
function ttSelectEasy(){ TT.selectedTables.clear(); [2,3,4,5,10].forEach(n=>TT.selectedTables.add(n)); refreshCells(); updateStartBtn(); }
function refreshCells(){ for(let i=1;i<=10;i++){ const c=$(`tt-cell-${i}`); if(c) c.classList.toggle('selected',TT.selectedTables.has(i)); } }
function updateStartBtn(){
  const btn=$('tt-start-btn');
  if(btn) btn.disabled=TT.selectedTables.size===0;
}

function ttGenerateQuestions(){
  const tables=[...TT.selectedTables];
  const pool=[];
  // Generate all combinations for selected tables
  tables.forEach(a=>{
    for(let b=1;b<=10;b++) pool.push([a,b]);
  });
  // Shuffle pool
  for(let i=pool.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [pool[i],pool[j]]=[pool[j],pool[i]];
  }
  // Take TT.totalQ, ensure no consecutive duplicates
  const qs=[];
  let lastA=-1,lastB=-1;
  let shuffled=[...pool];
  while(qs.length<TT.totalQ && shuffled.length>0){
    const idx=shuffled.findIndex(([a,b])=>!(a===lastA&&b===lastB) && !(a===lastB&&b===lastA));
    if(idx===-1){ qs.push(shuffled[0]); shuffled.shift(); }
    else{ qs.push(shuffled[idx]); shuffled.splice(idx,1); }
    [lastA,lastB]=qs[qs.length-1];
  }
  // If pool smaller than totalQ, repeat with fresh shuffle
  while(qs.length<TT.totalQ){
    const pick=pool[Math.floor(Math.random()*pool.length)];
    qs.push(pick);
  }
  // Randomly flip some: 3×7 vs 7×3
  return qs.slice(0,TT.totalQ).map(([a,b])=>Math.random()>.5?[b,a]:[a,b]);
}

function ttStartTest(){
  TT.questions=ttGenerateQuestions();
  TT.current=0; TT.correct=0; TT.wrong=0; TT.missed=[];
  TT.timeLeft=TT.timeLimit; TT.testStartTime=Date.now();
  clearInterval(TT.timerInterval);
  ttRenderQuestion();
  TT.timerInterval=setInterval(ttTick,250);
}

function ttRenderQuestion(){
  if(TT.current>=TT.totalQ){ ttEndTest(); return; }
  const [a,b]=TT.questions[TT.current];
  const pct=Math.round((TT.current/TT.totalQ)*100);
  const timerColor=TT.timeLeft<30?'#ff4d4f':TT.timeLeft<60?'#faad14':'#7c3aed';
  const circumference=283;
  const dashOffset=circumference*(1-(TT.timeLeft/TT.timeLimit));

  render(`
    <div style="padding-top:20px">
      <button class="back-btn" onclick="ttConfirmExit()" style="border-color:#c4b5fd;color:#7c3aed;margin-bottom:14px">← Exit Test</button>

      <div class="tt-test-wrap">
        <!-- Timer + Stats bar -->
        <div class="tt-stats-bar">
          <div class="tt-stat">
            <div class="tt-stat-val" style="color:#52c41a">✅ ${TT.correct}</div>
            <div class="tt-stat-lbl">Correct</div>
          </div>
          <div class="tt-timer-ring">
            <svg width="80" height="80" viewBox="0 0 90 90">
              <circle class="tt-timer-track" cx="45" cy="45" r="40"/>
              <circle class="tt-timer-fill ${TT.timeLeft<30?'danger':''}" cx="45" cy="45" r="40"
                stroke-dasharray="${circumference}"
                stroke-dashoffset="${dashOffset}"
                stroke="${timerColor}"
                id="tt-timer-arc"/>
            </svg>
            <div class="tt-timer-text" id="tt-timer-display" style="color:${timerColor}">${ttFormatTime(TT.timeLeft)}</div>
          </div>
          <div class="tt-stat">
            <div class="tt-stat-val" style="color:#ff4d4f">❌ ${TT.wrong}</div>
            <div class="tt-stat-lbl">Wrong</div>
          </div>
        </div>

        <!-- Progress -->
        <div class="tt-progress-bar"><div class="tt-progress-fill" style="width:${pct}%"></div></div>
        <div class="tt-progress-label">Question ${TT.current+1} of ${TT.totalQ}</div>

        <!-- Question -->
        <div class="tt-question-card" id="tt-q-card">
          <div class="tt-question-num">Question ${TT.current+1} of ${TT.totalQ}</div>
          <div class="tt-question-text" id="tt-q-text">${a} × ${b} = ?</div>
          <input class="tt-answer-input" id="tt-ans-input" type="number" inputmode="numeric"
            placeholder="?" autocomplete="off" autofocus
            onkeydown="if(event.key==='Enter'){event.preventDefault();ttSubmitAnswer();}"
            oninput="this.value=this.value.replace(/[^0-9]/g,'')">
          <div class="tt-hint" id="tt-hint"></div>
        </div>

        <!-- Submit button (for touch users) -->
        <button onclick="ttSubmitAnswer()" style="
          width:100%;background:linear-gradient(135deg,#7c3aed,#a78bfa);
          color:white;border:none;border-radius:14px;padding:16px;
          font-size:18px;font-weight:900;font-family:inherit;cursor:pointer;
          box-shadow:0 4px 18px #7c3aed44;transition:transform .18s;"
          onmouseenter="this.style.transform='scale(1.02)'"
          onmouseleave="this.style.transform='none'">
          Submit ✓
        </button>
      </div>
    </div>
  `);
  // Focus the input
  setTimeout(()=>{ const inp=$('tt-ans-input'); if(inp){ inp.focus(); inp.select(); } },100);
}

function ttTick(){
  TT.timeLeft-=0.25;
  if(TT.timeLeft<=0){ TT.timeLeft=0; clearInterval(TT.timerInterval); ttEndTest(); return; }
  // Update timer display and arc without re-rendering whole page
  const disp=$('tt-timer-display');
  const arc=$('tt-timer-arc');
  if(!disp){ clearInterval(TT.timerInterval); return; }
  const color=TT.timeLeft<30?'#ff4d4f':TT.timeLeft<60?'#faad14':'#7c3aed';
  disp.textContent=ttFormatTime(TT.timeLeft);
  disp.style.color=color;
  if(arc){
    const offset=283*(1-(TT.timeLeft/TT.timeLimit));
    arc.setAttribute('stroke-dashoffset',offset);
    arc.setAttribute('stroke',color);
    arc.classList.toggle('danger',TT.timeLeft<30);
  }
}

function ttFormatTime(s){
  const m=Math.floor(s/60), sec=Math.floor(s%60);
  return `${m}:${String(sec).padStart(2,'0')}`;
}

function ttSubmitAnswer(){
  const inp=$('tt-ans-input');
  if(!inp) return;
  const val=parseInt(inp.value);
  const [a,b]=TT.questions[TT.current];
  const correct=a*b;
  const card=$('tt-q-card');
  const hint=$('tt-hint');

  if(isNaN(val) || inp.value.trim()===''){
    inp.style.borderColor='#faad14';
    if(hint) hint.innerHTML='<span style="color:#d48806">Please type a number first!</span>';
    inp.focus();
    return;
  }

  if(val===correct){
    TT.correct++;
    inp.classList.add('correct');
    if(card){ card.classList.add('flash-correct'); }
    if(hint) hint.innerHTML=`<span style="color:#52c41a">✅ Correct! ${a} × ${b} = ${correct}</span>`;
    TT.current++;
    setTimeout(()=>{
      if(TT.current>=TT.totalQ){ clearInterval(TT.timerInterval); ttEndTest(); }
      else ttRenderQuestion();
    }, 350);
  } else {
    TT.wrong++;
    TT.missed.push({q:`${a} × ${b}`, correct, given:val});
    inp.classList.add('wrong');
    if(card){ card.classList.add('flash-wrong'); }
    if(hint) hint.innerHTML=`<span style="color:#ff4d4f">❌ Not quite! The answer is <strong>${correct}</strong></span>`;
    TT.current++;
    setTimeout(()=>{
      if(TT.current>=TT.totalQ){ clearInterval(TT.timerInterval); ttEndTest(); }
      else ttRenderQuestion();
    }, 800);
  }
}

function ttConfirmExit(){
  clearInterval(TT.timerInterval);
  if(confirm('Are you sure you want to exit the test? Your progress will be lost.')) showTimesTablesHub();
  else { TT.timerInterval=setInterval(ttTick,250); }
}

function ttEndTest(){
  clearInterval(TT.timerInterval);
  TT.totalTime=Math.round((Date.now()-TT.testStartTime)/1000);
  const total=TT.correct+TT.wrong;
  const pct=TT.totalQ>0?Math.round((TT.correct/TT.totalQ)*100):0;
  const timeTaken=TT.timeLimit-TT.timeLeft;

  // Update high score
  if(TT.correct>TT.highScore){
    TT.highScore=TT.correct;
    try{ localStorage.setItem('tt_high',TT.highScore); }catch(e){}
  }

  const grade=pct>=90?'A+':pct>=80?'A':pct>=70?'B':pct>=60?'C':'D';
  const gradeColor=pct>=90?'#52c41a':pct>=80?'#7c3aed':pct>=70?'#1890ff':pct>=60?'#faad14':'#ff4d4f';
  const unlocked=pct>=90;

  const missedHtml=TT.missed.length>0?`
    <div class="tt-missed-wrap">
      <div class="tt-missed-title">📝 Review these — practice them again!</div>
      ${TT.missed.map(m=>`<span class="tt-missed-item">${m.q} = <strong>${m.correct}</strong> (you said ${m.given})</span>`).join('')}
    </div>`:
    `<div style="background:linear-gradient(135deg,#f6ffed,#d9f7be);border:2px solid #52c41a;border-radius:14px;padding:14px 18px;margin:14px auto;max-width:440px;text-align:center">
      <div style="font-size:24px;margin-bottom:4px">🏆</div>
      <div style="font-weight:800;font-size:16px;color:#237804">Perfect Score! No mistakes!</div>
    </div>`;

  const unlockHtml=unlocked?`
    <div class="tt-unlock-banner">
      <div class="tt-unlock-icon">🐍</div>
      <div class="tt-unlock-title">Snake Unlocked!</div>
      <div class="tt-unlock-sub">You scored ${pct}% — amazing work! Enjoy a round of Snake as your reward!</div>
      <button class="tt-overlay-btn" onclick="launchSnake()" style="
        margin-top:14px;background:linear-gradient(135deg,#4ade80,#22d3ee);
        border:none;border-radius:12px;padding:13px 28px;font-size:17px;
        font-weight:900;font-family:inherit;cursor:pointer;color:#0a0a1a;
        box-shadow:0 4px 20px #4ade8044;transition:transform .18s;"
        onmouseenter="this.style.transform='scale(1.04)'"
        onmouseleave="this.style.transform='none'">
        🎮 Play Snake Now!
      </button>
    </div>`:`
    <div style="background:#f8f8f8;border:2px solid #e0e0e0;border-radius:16px;padding:16px 18px;margin:14px auto;max-width:440px;text-align:center">
      <div style="font-size:28px;margin-bottom:6px">🎯</div>
      <div style="font-weight:800;font-size:15px;color:#555">Score 90% (18/20) to unlock Snake!</div>
      <div style="font-size:13px;color:#999;margin-top:4px;font-weight:600">You got ${TT.correct}/20 — keep practising!</div>
    </div>`;

  const msg=pct>=90?'Outstanding! You have mastered your times tables! 🏆':
            pct>=80?'Excellent work! You are very close to mastery! ⭐':
            pct>=70?'Good effort! Keep practising the ones you missed! 💪':
            pct>=60?'A solid start — review the missed ones and try again! 📖':
            'Keep going — every attempt makes you stronger! 🌱';

  render(`
    <div class="tt-results fade-up">
      <button class="back-btn" onclick="showTimesTablesHub()" style="border-color:#c4b5fd;color:#7c3aed;margin-bottom:16px">← Choose Tables</button>

      <h2 style="font-weight:900;font-size:28px;color:#1a1a2e;margin-bottom:6px">Test Complete! 🎓</h2>
      <p style="font-size:14px;color:#888;font-weight:600;margin-bottom:20px">Times Tables · ${ttSelectedLabel()}</p>

      <div class="tt-grade-circle" style="background:linear-gradient(135deg,${gradeColor},${gradeColor}cc)">
        <div class="tt-grade-pct">${pct}%</div>
        <div class="tt-grade-letter">Grade ${grade}</div>
      </div>

      <p style="font-size:15px;font-weight:700;color:#555;max-width:380px;margin:0 auto 16px;line-height:1.6">${msg}</p>

      <div class="tt-result-grid">
        <div class="tt-result-stat">
          <div class="tt-result-stat-val" style="color:#52c41a">${TT.correct}</div>
          <div class="tt-result-stat-lbl">✅ Correct</div>
        </div>
        <div class="tt-result-stat">
          <div class="tt-result-stat-val" style="color:#ff4d4f">${TT.wrong}</div>
          <div class="tt-result-stat-lbl">❌ Wrong</div>
        </div>
        <div class="tt-result-stat">
          <div class="tt-result-stat-val">${ttFormatTime(timeTaken)}</div>
          <div class="tt-result-stat-lbl">⏱ Time Used</div>
        </div>
      </div>

      ${missedHtml}
      ${unlockHtml}

      <div class="tt-btn-row">
        <button class="tt-btn tt-btn-primary" onclick="ttStartTest()">🔄 Try Again</button>
        <button class="tt-btn tt-btn-outline" onclick="showTimesTablesHub()">⚙️ Change Tables</button>
        <button class="tt-btn tt-btn-home" onclick="showDashboard()">🏠 Dashboard</button>
      </div>
    </div>
  `);
  setTimeout(()=>showBonusNotification('tt',pct),300);
}

function ttSelectedLabel(){
  const arr=[...TT.selectedTables].sort((a,b)=>a-b);
  if(arr.length===10) return 'All Tables (1–10)';
  if(arr.length===0) return 'None selected';
  return arr.map(n=>n+'×').join(' ');
}

// ═══════════════════════════════════════════════════════
//  SNAKE GAME ENGINE
// ═══════════════════════════════════════════════════════
const SNAKE = {
  grid:18,          // cells across & down
  cellSize:20,      // px per cell
  snake:[],
  dir:{x:1,y:0},
  nextDir:{x:1,y:0},
  food:{x:0,y:0},
  score:0,
  highScore:parseInt(localStorage.getItem('snake_high')||'0'),
  speed:150,        // ms per frame (starts at 150, speeds up)
  interval:null,
  running:false,
  gameOver:false,
  canvas:null,
  ctx:null,
};

function launchSnake(){
  const screen=$('snake-screen');
  if(!screen) return;
  screen.style.display='flex';
  // Size canvas to fit screen nicely
  const size=Math.min(360, window.innerWidth-48, Math.round(window.innerHeight*0.55));
  const cellSize=Math.floor(size/SNAKE.grid);
  SNAKE.cellSize=cellSize;
  SNAKE.canvas=$('snake-canvas');
  SNAKE.canvas.width=cellSize*SNAKE.grid;
  SNAKE.canvas.height=cellSize*SNAKE.grid;
  SNAKE.ctx=SNAKE.canvas.getContext('2d');
  SNAKE.score=0;
  SNAKE.running=false; SNAKE.gameOver=false;
  updateSnakeUI();
  snakeDrawIdle();
  // Show start overlay
  const ov=$('snake-overlay');
  if(ov) ov.style.display='flex';
  // Keyboard listener
  window._snakeKeyHandler=e=>{
    const map={ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0],
               w:[0,-1],s:[0,1],a:[-1,0],d:[1,0],W:[0,-1],S:[0,1],A:[-1,0],D:[1,0]};
    const d=map[e.key];
    if(d){ e.preventDefault(); snakeDir(d[0],d[1]); }
  };
  document.addEventListener('keydown',window._snakeKeyHandler);
}

function snakeDrawIdle(){
  const c=SNAKE.canvas, ctx=SNAKE.ctx, cs=SNAKE.cellSize, g=SNAKE.grid;
  if(!ctx) return;
  ctx.fillStyle='#0f172a';
  ctx.fillRect(0,0,c.width,c.height);
  // Draw grid dots
  ctx.fillStyle='#1e293b';
  for(let x=0;x<g;x++) for(let y=0;y<g;y++)
    ctx.fillRect(x*cs+cs/2-1,y*cs+cs/2-1,2,2);
}

function snakeStart(){
  const ov=$('snake-overlay'); if(ov) ov.style.display='none';
  SNAKE.grid=18;
  const g=SNAKE.grid;
  SNAKE.snake=[{x:Math.floor(g/2),y:Math.floor(g/2)},{x:Math.floor(g/2)-1,y:Math.floor(g/2)}];
  SNAKE.dir={x:1,y:0}; SNAKE.nextDir={x:1,y:0};
  SNAKE.score=0; SNAKE.speed=150; SNAKE.running=true; SNAKE.gameOver=false;
  snakePlaceFood();
  updateSnakeUI();
  clearInterval(SNAKE.interval);
  SNAKE.interval=setInterval(snakeStep,SNAKE.speed);
}

function snakeDir(dx,dy){
  // Prevent 180° reverse
  if(dx===1&&SNAKE.dir.x===-1) return;
  if(dx===-1&&SNAKE.dir.x===1) return;
  if(dy===1&&SNAKE.dir.y===-1) return;
  if(dy===-1&&SNAKE.dir.y===1) return;
  SNAKE.nextDir={x:dx,y:dy};
}

function snakePlaceFood(){
  const g=SNAKE.grid;
  let pos;
  do{ pos={x:Math.floor(Math.random()*g),y:Math.floor(Math.random()*g)}; }
  while(SNAKE.snake.some(s=>s.x===pos.x&&s.y===pos.y));
  SNAKE.food=pos;
}

function snakeStep(){
  if(!SNAKE.running) return;
  SNAKE.dir=SNAKE.nextDir;
  const head={x:SNAKE.snake[0].x+SNAKE.dir.x, y:SNAKE.snake[0].y+SNAKE.dir.y};
  const g=SNAKE.grid;
  // Wall collision
  if(head.x<0||head.x>=g||head.y<0||head.y>=g){ snakeGameOver(); return; }
  // Self collision
  if(SNAKE.snake.some(s=>s.x===head.x&&s.y===head.y)){ snakeGameOver(); return; }
  SNAKE.snake.unshift(head);
  if(head.x===SNAKE.food.x&&head.y===SNAKE.food.y){
    SNAKE.score+=10;
    snakePlaceFood();
    // Speed up every 5 food (min 60ms)
    if(SNAKE.score%50===0&&SNAKE.speed>60){
      SNAKE.speed=Math.max(60,SNAKE.speed-15);
      clearInterval(SNAKE.interval);
      SNAKE.interval=setInterval(snakeStep,SNAKE.speed);
    }
  } else {
    SNAKE.snake.pop();
  }
  if(SNAKE.score>SNAKE.highScore){
    SNAKE.highScore=SNAKE.score;
    try{ localStorage.setItem('snake_high',SNAKE.highScore); }catch(e){}
  }
  updateSnakeUI();
  snakeDraw();
}

function snakeDraw(){
  const c=SNAKE.canvas, ctx=SNAKE.ctx, cs=SNAKE.cellSize, g=SNAKE.grid;
  if(!ctx) return;
  // Background
  ctx.fillStyle='#0f172a';
  ctx.fillRect(0,0,c.width,c.height);
  // Grid
  ctx.fillStyle='#1e293b';
  for(let x=0;x<g;x++) for(let y=0;y<g;y++)
    ctx.fillRect(x*cs+cs/2-1,y*cs+cs/2-1,2,2);
  // Food
  const fx=SNAKE.food.x*cs, fy=SNAKE.food.y*cs;
  ctx.fillStyle='#ef4444';
  ctx.beginPath();
  ctx.arc(fx+cs/2,fy+cs/2,cs/2-2,0,Math.PI*2);
  ctx.fill();
  // Shine on food
  ctx.fillStyle='rgba(255,255,255,0.3)';
  ctx.beginPath();
  ctx.arc(fx+cs/2-2,fy+cs/2-2,cs/5,0,Math.PI*2);
  ctx.fill();
  // Snake body
  SNAKE.snake.forEach((seg,i)=>{
    const isHead=i===0;
    const ratio=i/SNAKE.snake.length;
    const r=Math.round(74+(1-ratio)*10), g2=Math.round(222-(1-ratio)*60), b=Math.round(128-(1-ratio)*60);
    ctx.fillStyle=isHead?`#22c55e`:`rgb(${r},${g2},${b})`;
    const pad=isHead?1:2;
    ctx.beginPath();
    const rx=seg.x*cs+pad, ry=seg.y*cs+pad, rw=cs-pad*2, rh=cs-pad*2, rr=4;
    ctx.moveTo(rx+rr,ry);
    ctx.lineTo(rx+rw-rr,ry); ctx.quadraticCurveTo(rx+rw,ry,rx+rw,ry+rr);
    ctx.lineTo(rx+rw,ry+rh-rr); ctx.quadraticCurveTo(rx+rw,ry+rh,rx+rw-rr,ry+rh);
    ctx.lineTo(rx+rr,ry+rh); ctx.quadraticCurveTo(rx,ry+rh,rx,ry+rh-rr);
    ctx.lineTo(rx,ry+rr); ctx.quadraticCurveTo(rx,ry,rx+rr,ry);
    ctx.closePath(); ctx.fill();
    // Head eyes
    if(isHead){
      ctx.fillStyle='#0f172a';
      const ex1={x:seg.x*cs+cs*0.3, y:seg.y*cs+cs*0.3};
      const ex2={x:seg.x*cs+cs*0.7, y:seg.y*cs+cs*0.3};
      // Adjust eyes based on direction
      ctx.beginPath();
      ctx.arc(ex1.x,ex1.y,cs/8,0,Math.PI*2); ctx.fill();
      ctx.beginPath();
      ctx.arc(ex2.x,ex2.y,cs/8,0,Math.PI*2); ctx.fill();
    }
  });
}

function snakeGameOver(){
  SNAKE.running=false;
  clearInterval(SNAKE.interval);
  SNAKE.gameOver=true;
  const ov=$('snake-overlay');
  if(ov){
    ov.style.display='flex';
    ov.innerHTML=`
      <div class="snake-overlay-title">💀 Game Over!</div>
      <div class="snake-overlay-score">${SNAKE.score}</div>
      <div class="snake-overlay-sub">Score · Best: ${SNAKE.highScore}</div>
      <div style="margin-bottom:16px;font-size:14px;color:#6b7280;font-weight:700">Length: ${SNAKE.snake.length}</div>
      <div style="font-size:13px;color:#4b5563;font-weight:700;margin-bottom:16px;padding:10px 16px;background:rgba(255,255,255,0.06);border-radius:10px;line-height:1.6">
        That was your one round! 🎉<br>Score 90%+ again to unlock another game.
      </div>
      <button class="snake-overlay-btn" onclick="exitSnake()">📝 Take Another Test</button>
    `;
  }
}

function updateSnakeUI(){
  const sv=$('snake-score'), sl=$('snake-length'), sh=$('snake-high');
  if(sv) sv.textContent=SNAKE.score;
  if(sl) sl.textContent=SNAKE.snake.length||1;
  if(sh) sh.textContent=SNAKE.highScore;
}

function exitSnake(){
  clearInterval(SNAKE.interval);
  SNAKE.running=false;
  document.removeEventListener('keydown',window._snakeKeyHandler);
  const screen=$('snake-screen'); if(screen) screen.style.display='none';
  // Go straight to the test hub so they can take another test
  showTimesTablesHub();
}

// ═══════════════════════════════════════════════════════
// PARENT PANEL — PIN + BONUS MINUTES
// ═══════════════════════════════════════════════════════
const BONUS_DEFAULTS = {
  tt_hard_100:15, tt_hard_95:10, tt_hard_90:5,
  tt_easy_100:5,
  topic_100:15, topic_95:15, topic_90:15
};
function getBonusSettings(){
  const s={};
  for(const[k,def]of Object.entries(BONUS_DEFAULTS)){
    const stored=localStorage.getItem('bonus_'+k);
    s[k]=stored!==null?parseInt(stored):def;
  }
  return s;
}
function saveBonusSetting(key,val){
  try{localStorage.setItem('bonus_'+key,val);}catch(e){}
}
function getParentPin(){return localStorage.getItem('parent_pin')||null;}
function saveParentPin(pin){try{localStorage.setItem('parent_pin',pin);}catch(e){}}

function openParentPinModal(){
  const existingPin=getParentPin();
  const overlay=document.createElement('div');
  overlay.className='modal-overlay';
  overlay.id='pin-modal-overlay';
  if(!existingPin){
    overlay.innerHTML=`
      <div class="modal-card">
        <div style="font-size:48px;margin-bottom:12px">&#128272;</div>
        <div class="modal-title">Create a Parent PIN</div>
        <div class="modal-sub">Set a 4-digit PIN to protect parent settings. You will need this every time you open Parent Settings.</div>
        <input class="pin-input" id="pin-new" type="password" inputmode="numeric" maxlength="4" placeholder="&#8226;&#8226;&#8226;&#8226;" oninput="this.value=this.value.replace(/[^0-9]/g,'').slice(0,4)">
        <div style="margin-top:10px;font-size:13px;font-weight:700;color:#888">Confirm PIN</div>
        <input class="pin-input" id="pin-confirm" type="password" inputmode="numeric" maxlength="4" placeholder="&#8226;&#8226;&#8226;&#8226;" style="margin-top:6px" oninput="this.value=this.value.replace(/[^0-9]/g,'').slice(0,4)" onkeydown="if(event.key==='Enter')confirmNewPin()">
        <div class="modal-error" id="pin-error"></div>
        <button class="modal-btn modal-btn-primary" onclick="confirmNewPin()">Set PIN &amp; Open Settings</button>
        <button class="modal-btn modal-btn-outline" onclick="closePinModal()">Cancel</button>
      </div>`;
  }else{
    overlay.innerHTML=`
      <div class="modal-card">
        <div style="font-size:48px;margin-bottom:12px">&#128274;</div>
        <div class="modal-title">Parent Settings</div>
        <div class="modal-sub">Enter your 4-digit PIN to continue.</div>
        <input class="pin-input" id="pin-entry" type="password" inputmode="numeric" maxlength="4" placeholder="&#8226;&#8226;&#8226;&#8226;" oninput="this.value=this.value.replace(/[^0-9]/g,'').slice(0,4)" onkeydown="if(event.key==='Enter')checkEntryPin()">
        <div class="modal-error" id="pin-error"></div>
        <button class="modal-btn modal-btn-primary" onclick="checkEntryPin()">Unlock</button>
        <button class="modal-btn modal-btn-outline" onclick="closePinModal()">Cancel</button>
      </div>`;
  }
  document.body.appendChild(overlay);
  setTimeout(()=>{
    const inp=document.getElementById(existingPin?'pin-entry':'pin-new');
    if(inp)inp.focus();
  },100);
}

function closePinModal(){
  const ov=document.getElementById('pin-modal-overlay');
  if(ov)ov.remove();
}

function confirmNewPin(){
  const p1=(document.getElementById('pin-new')||{}).value||'';
  const p2=(document.getElementById('pin-confirm')||{}).value||'';
  const err=document.getElementById('pin-error');
  if(p1.length!==4){if(err)err.textContent='PIN must be exactly 4 digits.';return;}
  if(p1!==p2){if(err)err.textContent='PINs do not match. Please try again.';return;}
  saveParentPin(p1);
  closePinModal();
  showParentPanel();
}

function checkEntryPin(){
  const entered=(document.getElementById('pin-entry')||{}).value||'';
  const err=document.getElementById('pin-error');
  if(entered===getParentPin()){
    closePinModal();
    showParentPanel();
  }else{
    if(err)err.textContent='Incorrect PIN. Please try again.';
    const inp=document.getElementById('pin-entry');
    if(inp){inp.value='';inp.focus();}
  }
}

function openChangePinModal(){
  const overlay=document.createElement('div');
  overlay.className='modal-overlay';
  overlay.id='pin-modal-overlay';
  overlay.innerHTML=`
    <div class="modal-card">
      <div style="font-size:48px;margin-bottom:12px">&#128273;</div>
      <div class="modal-title">Change PIN</div>
      <div class="modal-sub">Enter your current PIN, then set a new one.</div>
      <input class="pin-input" id="pin-current" type="password" inputmode="numeric" maxlength="4" placeholder="Current PIN" oninput="this.value=this.value.replace(/[^0-9]/g,'').slice(0,4)">
      <input class="pin-input" id="pin-new" type="password" inputmode="numeric" maxlength="4" placeholder="New PIN" style="margin-top:10px" oninput="this.value=this.value.replace(/[^0-9]/g,'').slice(0,4)">
      <input class="pin-input" id="pin-confirm" type="password" inputmode="numeric" maxlength="4" placeholder="Confirm New PIN" style="margin-top:10px" oninput="this.value=this.value.replace(/[^0-9]/g,'').slice(0,4)" onkeydown="if(event.key==='Enter')doChangePin()">
      <div class="modal-error" id="pin-error"></div>
      <button class="modal-btn modal-btn-primary" onclick="doChangePin()">Update PIN</button>
      <button class="modal-btn modal-btn-outline" onclick="closePinModal()">Cancel</button>
    </div>`;
  document.body.appendChild(overlay);
  setTimeout(()=>{const inp=document.getElementById('pin-current');if(inp)inp.focus();},100);
}

function doChangePin(){
  const cur=(document.getElementById('pin-current')||{}).value||'';
  const p1=(document.getElementById('pin-new')||{}).value||'';
  const p2=(document.getElementById('pin-confirm')||{}).value||'';
  const err=document.getElementById('pin-error');
  if(cur!==getParentPin()){if(err)err.textContent='Current PIN is incorrect.';return;}
  if(p1.length!==4){if(err)err.textContent='New PIN must be exactly 4 digits.';return;}
  if(p1!==p2){if(err)err.textContent='New PINs do not match.';return;}
  saveParentPin(p1);
  closePinModal();
  const banner=document.createElement('div');
  banner.style.cssText='position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#00b894;color:white;border-radius:14px;padding:12px 24px;font-weight:800;font-size:15px;z-index:2000;box-shadow:0 4px 20px rgba(0,184,148,.4);white-space:nowrap;';
  banner.textContent='PIN updated successfully!';
  document.body.appendChild(banner);
  setTimeout(()=>banner.remove(),2500);
}

function showParentPanel(){
  VIEW='parent';
  setStrandCSSVars(null);updateNav();
  ['nc1','nc2','nc3','nc4'].forEach(id=>$(id).style.display='none');
  const s=getBonusSettings();
  const stepper=(key,label,badge)=>`
    <div class="stepper-row">
      <div class="stepper-label">${label}<span class="stepper-badge">${badge}</span></div>
      <div class="stepper-controls">
        <button class="stepper-btn" onclick="adjustBonus('${key}',-5)">&#8722;</button>
        <div class="stepper-val" id="bonus-val-${key}">${s[key]} min</div>
        <button class="stepper-btn" onclick="adjustBonus('${key}',5)">+</button>
      </div>
    </div>`;
  render(`
    <div class="page-header" style="padding-top:18px;margin-bottom:16px">
      <button class="back-btn" onclick="showDashboard()" style="border-color:#636e72;color:#2d3436;margin-bottom:12px">&#8592; Dashboard</button>
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
        <div>
          <h2 style="font-weight:900;font-size:26px;color:#1a1a2e;margin-bottom:3px">&#128274; Parent Settings</h2>
          <p style="font-size:13px;color:#888;font-weight:600">All changes save automatically</p>
        </div>
        <button onclick="openChangePinModal()" style="background:white;border:2px solid #e0e0e0;border-radius:12px;padding:9px 16px;font-size:14px;font-weight:800;cursor:pointer;font-family:inherit;color:#555;display:flex;align-items:center;gap:6px;">&#128273; Change PIN</button>
      </div>
    </div>
    <div class="parent-panel-wrap">
      <div class="parent-section-title">&#10006;&#65039; Times Tables &#8212; Hard (6&#8211;9 included)</div>
      ${stepper('tt_hard_100','100% score &#8212; Perfect!','Every question correct')}
      ${stepper('tt_hard_95','95&#8211;99% score &#8212; Excellent','18&#8211;19 out of 20')}
      ${stepper('tt_hard_90','90&#8211;94% score &#8212; Great','Minimum to earn bonus')}
      <div class="parent-section-title">&#11088; Times Tables &#8212; Easy (2&#8211;5, 10 only)</div>
      ${stepper('tt_easy_100','100% score &#8212; Perfect!','Every question correct')}
      <div class="parent-section-title">&#128218; Curriculum Topics</div>
      ${stepper('topic_100','100% score &#8212; Perfect!','25 out of 25 correct')}
      ${stepper('topic_95','95&#8211;99% score &#8212; Excellent','23&#8211;24 out of 25')}
      ${stepper('topic_90','90&#8211;94% score &#8212; Great','Minimum to earn bonus')}
      <div style="background:#f8f8f8;border:2px solid #e0e0e0;border-radius:16px;padding:16px 18px;margin-top:24px;">
        <div style="font-weight:800;font-size:14px;color:#555;margin-bottom:6px">&#8505;&#65039; How bonus minutes work</div>
        <div style="font-size:13px;color:#888;line-height:1.7;font-weight:600">
          When a student completes a quiz and meets the score threshold, they see a notification showing how many bonus minutes they have earned. Use +/&#8722; to set the reward in 5-minute increments (0&#8211;60 min). Set to 0 to disable a reward tier.
        </div>
      </div>
    </div>
  `);
}

function adjustBonus(key,delta){
  const s=getBonusSettings();
  const newVal=Math.min(60,Math.max(0,(s[key]||0)+delta));
  saveBonusSetting(key,newVal);
  const el=$('bonus-val-'+key);
  if(el)el.textContent=newVal+' min';
}

function calcBonus(type,pct){
  const s=getBonusSettings();
  if(type==='tt_hard'){
    if(pct===100)return s.tt_hard_100;
    if(pct>=95)return s.tt_hard_95;
    if(pct>=90)return s.tt_hard_90;
  }else if(type==='tt_easy'){
    if(pct===100)return s.tt_easy_100;
  }else if(type==='topic'){
    if(pct===100)return s.topic_100;
    if(pct>=95)return s.topic_95;
    if(pct>=90)return s.topic_90;
  }
  return 0;
}

function isTTEasy(){
  const easyTables=new Set([2,3,4,5,10]);
  return [...TT.selectedTables].every(t=>easyTables.has(t));
}

function showBonusNotification(quizType,pct){
  let bonusType;
  if(quizType==='tt'){bonusType=isTTEasy()?'tt_easy':'tt_hard';}
  else{bonusType='topic';}
  const bonus=calcBonus(bonusType,pct);
  if(!bonus||bonus<=0)return;
  const banner=document.createElement('div');
  banner.className='bonus-banner fade-up';
  banner.innerHTML=`
    <div class="bonus-banner-icon">&#9203;&#65039;</div>
    <div class="bonus-banner-title">You earned ${bonus} bonus minute${bonus!==1?'s':''}!</div>
    <div class="bonus-banner-sub">Great work scoring ${pct}% &#8212; show this to a parent to claim your reward! &#127881;</div>`;
  const app=$('app');
  if(app)app.appendChild(banner);
}


// Year Level Generators - QLD Curriculum v9.0 2026

function genP_counting(){var t=[function(){var n=rnd(5,15);return{q:'Count the stars:\n'+'⭐'.repeat(n),a:''+n,steps:['Count each star.','Total='+n,'✅ '+n]};},function(){var n=rnd(1,18);return{q:'What comes next?\n'+n+', __',a:''+(n+1),steps:['Count on 1','After '+n+' is '+(n+1),'✅ '+(n+1)]};},function(){var a=rnd(1,5),b=rnd(1,5);return{q:''+a+' + '+b+' = ?',a:''+(a+b),steps:[a+' + '+b+' = '+(a+b),'✅ '+(a+b)]};},function(){var t2=rnd(3,9),r=rnd(1,t2-1);return{q:''+t2+' birds. '+r+' fly away.\nHow many left?',a:''+(t2-r),steps:[t2+' - '+r+' = '+(t2-r),'✅ '+(t2-r)]};},function(){var s=['triangle','square','circle','rectangle'],sh=s[rnd(0,3)];var sd={triangle:3,square:4,circle:0,rectangle:4};return{q:'How many sides does a '+sh+' have?',a:''+sd[sh],steps:['A '+sh+' has '+sd[sh]+' sides.','✅ '+sd[sh]]};},function(){var ns=[rnd(1,5),rnd(6,10),rnd(11,15),rnd(16,20)],sh=[...ns].sort(()=>Math.random()-.5);return{q:'Order smallest to largest:\n'+sh.join(', '),a:ns.join(', '),steps:['Find smallest first.','✅ '+ns.join(', ')]};},];return t[rnd(0,t.length-1)]();}
function gen1_placeValue(){var t=[function(){var a=rnd(1,9),b=rnd(0,9);return{q:'What number has '+a+' tens and '+b+' ones?',a:''+(a*10+b),steps:[a+' tens = '+(a*10),'+ '+b+' ones','✅ '+(a*10+b)]};},function(){var n=rnd(10,99);return{q:'How many tens in '+n+'?',a:''+Math.floor(n/10),steps:[n+' = '+Math.floor(n/10)+' tens and '+(n%10)+' ones','✅ '+Math.floor(n/10)]};},function(){var n=rnd(10,89);return{q:'10 more than '+n+'?',a:''+(n+10),steps:[n+' + 10 = '+(n+10),'✅ '+(n+10)]};},function(){var n=rnd(20,99);return{q:'10 less than '+n+'?',a:''+(n-10),steps:[n+' - 10 = '+(n-10),'✅ '+(n-10)]};},];return t[rnd(0,t.length-1)]();}
function gen1_addSub20(){var t=[function(){var a=rnd(3,12),b=rnd(1,20-a);return{q:a+' + '+b+' = ?',a:''+(a+b),steps:['Count on '+b+' from '+a,'✅ '+(a+b)]};},function(){var a=rnd(10,20),b=rnd(1,a);return{q:a+' - '+b+' = ?',a:''+(a-b),steps:['Count back '+b+' from '+a,'✅ '+(a-b)]};},function(){var a=rnd(5,10),b=rnd(1,5);return{q:'Mia has '+a+' stickers.\nShe gets '+b+' more. How many now?',a:''+(a+b),steps:[a+' + '+b+' = '+(a+b),'✅ '+(a+b)+' stickers']};},function(){var a=rnd(10,18),b=rnd(1,a-1);return{q:a+' children at the park.\n'+b+' go home. How many left?',a:''+(a-b),steps:[a+' - '+b+' = '+(a-b),'✅ '+(a-b)+' children']};},];return t[rnd(0,t.length-1)]();}
function gen1_skipCount(){var t=[function(){var s=rnd(0,4)*2,q=Array.from({length:4},(_,i)=>s+i*2);return{q:'Skip count by 2s:\n'+q.join(', ')+', __',a:''+(s+8),steps:['Each step +2',q[3]+' + 2 = '+(s+8),'✅ '+(s+8)]};},function(){var s=rnd(0,2)*5,q=Array.from({length:4},(_,i)=>s+i*5);return{q:'Skip count by 5s:\n'+q.join(', ')+', __',a:''+(s+20),steps:['Each step +5',q[3]+' + 5 = '+(s+20),'✅ '+(s+20)]};},function(){var s=rnd(0,2)*10,q=Array.from({length:4},(_,i)=>s+i*10);return{q:'Skip count by 10s:\n'+q.join(', ')+', __',a:''+(s+40),steps:['Each step +10',q[3]+' + 10 = '+(s+40),'✅ '+(s+40)]};},];return t[rnd(0,t.length-1)]();}
function gen1_shapes(){var t=[function(){var sh=['triangle','square','rectangle','circle'],s=sh[rnd(0,3)];var c={triangle:3,square:4,rectangle:4,circle:0};return{q:'Corners on a '+s+'?',a:''+c[s],steps:['A '+s+' has '+c[s]+' corners.','✅ '+c[s]]};},function(){return{q:'Which shape has 4 equal sides?',a:'square',steps:['A square has 4 equal sides.','✅ square']};},function(){return{q:'Which shape has no corners?',a:'circle',steps:['A circle has no corners.','✅ circle']};},function(){var n=rnd(2,5);return{q:n+' triangles. Total sides?',a:''+(n*3),steps:[n+' x 3 = '+(n*3),'✅ '+(n*3)+' sides']};},];return t[rnd(0,t.length-1)]();}
function gen1_time(){var days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];var months=['January','February','March','April','May','June','July','August','September','October','November','December'];var t=[function(){var i=rnd(0,5);return{q:'Day after '+days[i]+'?',a:days[i+1],steps:['Days in order.','✅ '+days[i+1]]};},function(){var i=rnd(0,10);return{q:'Month after '+months[i]+'?',a:months[i+1],steps:['Months in order.','✅ '+months[i+1]]};},function(){var h=rnd(1,12);return{q:'Clock shows '+h+":00. What time?",a:h+" o'clock",steps:["Minute hand at 12 = o'clock",'✅ '+h+" o'clock"]};},function(){return{q:'Days in one week?',a:'7',steps:['Mon Tue Wed Thu Fri Sat Sun = 7','✅ 7']};},function(){return{q:'Months in one year?',a:'12',steps:['Jan to Dec = 12 months','✅ 12']};},];return t[rnd(0,t.length-1)]();}
function gen2_placeValue(){var t=[function(){var h=rnd(1,9),t2=rnd(0,9),o=rnd(0,9);return{q:'Number with '+h+' hundreds, '+t2+' tens, '+o+' ones?',a:''+(h*100+t2*10+o),steps:[h+' hundreds='+h*100,t2+' tens='+t2*10,o+' ones','✅ '+(h*100+t2*10+o)]};},function(){var n=rnd(100,899);return{q:'100 more than '+n+'?',a:''+(n+100),steps:[n+' + 100 = '+(n+100),'✅ '+(n+100)]};},function(){var a=rnd(20,80),b=rnd(10,100-a);return{q:a+' + '+b+' = ?',a:''+(a+b),steps:[a+' + '+b+' = '+(a+b),'✅ '+(a+b)]};},function(){var a=rnd(50,99),b=rnd(10,a-5);return{q:a+' - '+b+' = ?',a:''+(a-b),steps:[a+' - '+b+' = '+(a-b),'✅ '+(a-b)]};},];return t[rnd(0,t.length-1)]();}
function gen2_multiply(){var t=[function(){var g=rnd(2,5),e=rnd(2,8);return{q:g+' groups of '+e+'. Total?',a:''+(g*e),steps:[g+' x '+e+' = '+(g*e),'✅ '+(g*e)]};},function(){var n=rnd(2,10);return{q:n+' x 2 = ?',a:''+(n*2),steps:[n+' + '+n+' = '+(n*2),'✅ '+(n*2)]};},function(){var n=rnd(1,10);return{q:n+' x 5 = ?',a:''+(n*5),steps:['Skip by 5s: '+(n*5),'✅ '+(n*5)]};},function(){var n=rnd(1,10);return{q:n+' x 10 = ?',a:''+(n*10),steps:[n+' tens = '+(n*10),'✅ '+(n*10)]};},function(){var r=rnd(2,4),c=rnd(2,5);return{q:'Array: '+r+' rows, '+c+' columns. Total?',a:''+(r*c),steps:[r+' x '+c+' = '+(r*c),'✅ '+(r*c)]};},];return t[rnd(0,t.length-1)]();}
function gen2_fractions(){var t=[function(){var n=rnd(4,12)*2;return{q:'Half of '+n+'?',a:''+(n/2),steps:[n+' / 2 = '+(n/2),'✅ '+(n/2)]};},function(){var n=rnd(2,8)*4;return{q:'Quarter of '+n+'?',a:''+(n/4),steps:[n+' / 4 = '+(n/4),'✅ '+(n/4)]};},function(){var n=rnd(2,6)*4;return{q:'Three quarters of '+n+'?',a:''+(n*3/4),steps:['1/4 = '+(n/4),'3 x '+(n/4)+' = '+(n*3/4),'✅ '+(n*3/4)]};},function(){return{q:'Pizza cut into 4 equal pieces.\nYou eat 1. What fraction?',a:'1/4',steps:['1 out of 4 parts','✅ 1/4']};},function(){return{q:'Shape split into 2 equal parts,\n1 shaded. Fraction shaded?',a:'1/2',steps:['1 out of 2 parts','✅ 1/2']};},];return t[rnd(0,t.length-1)]();}
function gen2_time(){var t=[function(){var h=rnd(1,12);return{q:'Clock shows '+h+':30. What time?',a:h+':30',steps:['Minute hand at 6 = half past','✅ '+h+':30']};},function(){var h=rnd(1,12);return{q:'Clock shows '+h+':15. What time?',a:h+':15',steps:['Minute hand at 3 = quarter past','✅ '+h+':15']};},function(){var h=rnd(1,12);return{q:'Clock shows '+h+':45. What time?',a:h+':45',steps:['Minute hand at 9 = quarter to','✅ '+h+':45']};},function(){return{q:'Minutes in one hour?',a:'60',steps:['1 hour = 60 minutes','✅ 60']};},];return t[rnd(0,t.length-1)]();}
function gen2_length(){var t=[function(){var l=rnd(5,30);return{q:'Pencil is '+l+' cm. How many mm?',a:''+(l*10)+' mm',steps:['1 cm = 10 mm',l+' x 10 = '+(l*10)+' mm','✅ '+(l*10)+' mm']};},function(){var a=rnd(20,80),b=rnd(10,a-5);return{q:'Ribbon A='+a+'cm, Ribbon B='+b+'cm.\nHow much longer is A?',a:''+(a-b)+' cm',steps:[a+' - '+b+' = '+(a-b)+' cm','✅ '+(a-b)+' cm']};},function(){var m=rnd(2,9);return{q:'Path is '+m+' metres. How many cm?',a:''+(m*100)+' cm',steps:['1 m = 100 cm',m+' x 100 = '+(m*100)+' cm','✅ '+(m*100)+' cm']};},];return t[rnd(0,t.length-1)]();}
function gen3_placeValue(){var t=[function(){var n=rnd(1000,9999),th=Math.floor(n/1000);return{q:'Value of thousands digit in '+n+'?',a:''+(th*1000),steps:['Thousands digit: '+th,'Value: '+(th*1000),'✅ '+(th*1000)]};},function(){var n=rnd(1000,9000);return{q:'1000 more than '+n+'?',a:''+(n+1000),steps:[n+' + 1000 = '+(n+1000),'✅ '+(n+1000)]};},function(){var a=rnd(1000,5000),b=rnd(500,4000);return{q:a+' + '+b+' = ?',a:''+(a+b),steps:[a+' + '+b+' = '+(a+b),'✅ '+(a+b)]};},function(){var a=rnd(3000,9000),b=rnd(500,a-500);return{q:a+' - '+b+' = ?',a:''+(a-b),steps:[a+' - '+b+' = '+(a-b),'✅ '+(a-b)]};},];return t[rnd(0,t.length-1)]();}
function gen3_multiply(){var t=[function(){var a=rnd(2,10),b=rnd(2,10);return{q:a+' x '+b+' = ?',a:''+(a*b),steps:['Times table: '+a+' x '+b+' = '+(a*b),'✅ '+(a*b)]};},function(){var a=rnd(2,10),b=rnd(2,10);return{q:(a*b)+' ÷ '+b+' = ?',a:''+a,steps:[(a*b)+' ÷ '+b+' = '+a,'✅ '+a]};},function(){var p=rnd(2,6),e=rnd(2,9);return{q:p+' bags, '+e+' apples each.\nTotal apples?',a:''+(p*e),steps:[p+' x '+e+' = '+(p*e),'✅ '+(p*e)+' apples']};},function(){var t2=rnd(12,60),g=rnd(2,6),d=Math.floor(t2/g);return{q:t2+' stickers shared among '+g+'.\nHow many each?',a:''+d,steps:[t2+' ÷ '+g+' = '+d,'✅ '+d]};},];return t[rnd(0,t.length-1)]();}
function gen3_fractions(){var t=[function(){var tot=rnd(2,4)*6,n=rnd(1,3);return{q:''+n+'/3 of '+tot+'?',a:''+(tot*n/3),steps:['1/3 of '+tot+' = '+(tot/3),n+'/3 = '+n+' x '+(tot/3)+' = '+(tot*n/3),'✅ '+(tot*n/3)]};},function(){var tot=rnd(2,5)*8;return{q:'3/8 of '+tot+'?',a:''+(tot*3/8),steps:['1/8 of '+tot+' = '+(tot/8),'3 x '+(tot/8)+' = '+(tot*3/8),'✅ '+(tot*3/8)]};},function(){var d=rnd(4,8),n1=rnd(1,d-1),n2=rnd(1,d-1),s=n1+n2,g=gcd(s,d);return{q:n1+'/'+d+' + '+n2+'/'+d+' = ?',a:''+(s/g)+'/'+(d/g),steps:['Add numerators: '+s+'/'+d,'Simplify: '+(s/g)+'/'+(d/g),'✅ '+(s/g)+'/'+(d/g)]};},function(){var d=rnd(3,8),n=rnd(1,d-1);return{q:n+' out of '+d+' parts shaded.\nWrite as a fraction.',a:n+'/'+d,steps:['✅ '+n+'/'+d]};},];return t[rnd(0,t.length-1)]();}
function gen3_perimeter(){var t=[function(){var l=rnd(3,12),w=rnd(2,l);return{q:'Rectangle '+l+'cm x '+w+'cm.\nPerimeter?',a:''+(2*(l+w))+' cm',steps:['2 x ('+l+' + '+w+') = '+(2*(l+w))+' cm','✅ '+(2*(l+w))+' cm']};},function(){var s=rnd(3,12);return{q:'Square side '+s+'cm. Perimeter?',a:''+(4*s)+' cm',steps:['4 x '+s+' = '+(4*s)+' cm','✅ '+(4*s)+' cm']};},function(){var a=rnd(3,8),b=rnd(3,8),c=rnd(3,8);return{q:'Triangle sides '+a+', '+b+', '+c+' cm.\nPerimeter?',a:''+(a+b+c)+' cm',steps:[a+'+'+b+'+'+c+' = '+(a+b+c)+' cm','✅ '+(a+b+c)+' cm']};},function(){var P=rnd(4,8)*4;return{q:'Square perimeter='+P+' cm.\nSide length?',a:''+(P/4)+' cm',steps:[P+' ÷ 4 = '+(P/4)+' cm','✅ '+(P/4)+' cm']};},];return t[rnd(0,t.length-1)]();}
function gen3_angles(){var t=[function(){return{q:'What type of angle is exactly 90°?',a:'right angle',steps:['A right angle = 90°','✅ right angle']};},function(){var d=rnd(10,89);return{q:'Is '+d+'° acute, right, or obtuse?',a:'acute',steps:[d+'° < 90°','✅ acute']};},function(){var d=rnd(91,179);return{q:'Is '+d+'° acute, right, or obtuse?',a:'obtuse',steps:['90° < '+d+'° < 180°','✅ obtuse']};},function(){var a=rnd(30,80);return{q:'Straight line. One angle = '+a+'°.\nOther angle?',a:''+(180-a)+'°',steps:['180 - '+a+' = '+(180-a)+'°','✅ '+(180-a)+'°']};},];return t[rnd(0,t.length-1)]();}
function gen4_placeValue(){var t=[function(){var n=rnd(10000,900000);return{q:'10 000 more than '+n.toLocaleString()+'?',a:(n+10000).toLocaleString(),steps:[(n+10000).toLocaleString(),'✅ '+(n+10000).toLocaleString()]};},function(){var n=rnd(50000,500000),r=Math.round(n/10000)*10000;return{q:'Round '+n.toLocaleString()+' to nearest 10 000.',a:r.toLocaleString(),steps:[(Math.floor((n%10000)/1000)>=5?'Round up':'Round down'),'✅ '+r.toLocaleString()]};},function(){var a=rnd(10,90)*1000,b=rnd(10,90)*1000;return{q:a.toLocaleString()+' + '+b.toLocaleString()+' = ?',a:(a+b).toLocaleString(),steps:['✅ '+(a+b).toLocaleString()]};},];return t[rnd(0,t.length-1)]();}
function gen4_multiply(){var t=[function(){var a=rnd(12,99),b=rnd(2,9);return{q:a+' x '+b+' = ?',a:''+(a*b),steps:['('+Math.floor(a/10)*10+' + '+a%10+') x '+b,'= '+(Math.floor(a/10)*10*b)+' + '+(a%10*b),'= '+(a*b),'✅ '+(a*b)]};},function(){var a=rnd(10,50),b=rnd(11,19);return{q:a+' x '+b+' = ?',a:''+(a*b),steps:[a+' x '+b+' = '+(a*b),'✅ '+(a*b)]};},function(){var a=rnd(5,20),b=rnd(3,9),c=rnd(2,5);return{q:a+' x '+b+' x '+c+' = ?',a:''+(a*b*c),steps:[a+' x '+b+' = '+(a*b),(a*b)+' x '+c+' = '+(a*b*c),'✅ '+(a*b*c)]};},];return t[rnd(0,t.length-1)]();}
function gen4_divide(){var t=[function(){var b=rnd(2,9),a=rnd(2,12),r=rnd(0,b-1);return{q:(a*b+r)+' ÷ '+b+' = ?',a:a+' remainder '+r,steps:[b+' x '+a+' = '+(a*b),'Remainder: '+r,'✅ '+a+' remainder '+r]};},function(){var d=rnd(2,5),a=rnd(10,30);return{q:'Share '+(a*d)+' among '+d+'. How many each?',a:''+a,steps:[(a*d)+' ÷ '+d+' = '+a,'✅ '+a]};},function(){var d=rnd(2,9),a=rnd(3,10),r=rnd(1,d-1);return{q:(a*d+r)+' ÷ '+d+' = ? (with remainder)',a:a+' remainder '+r,steps:[d+' x '+a+' = '+(a*d),'Remainder = '+r,'✅ '+a+' remainder '+r]};},];return t[rnd(0,t.length-1)]();}
function gen4_fractions(){var t=[function(){var n=rnd(1,5),d=rnd(2,8),m=rnd(2,4);return{q:'Equivalent fraction to '+n+'/'+d+' (x'+m+')?',a:''+(n*m)+'/'+(d*m),steps:[n+'/'+d+' x '+m+'/'+m+' = '+(n*m)+'/'+(d*m),'✅ '+(n*m)+'/'+(d*m)]};},function(){var d=rnd(4,10),n1=rnd(1,d-1),n2=rnd(1,d-1),s=n1+n2,g=gcd(s,d);return{q:n1+'/'+d+' + '+n2+'/'+d+' = ? Simplify.',a:''+(s/g)+'/'+(d/g),steps:['Sum: '+s+'/'+d,'Simplify: '+(s/g)+'/'+(d/g),'✅ '+(s/g)+'/'+(d/g)]};},function(){var d=rnd(4,10),n1=rnd(3,d),n2=rnd(1,n1-1),df=n1-n2,g=gcd(df,d);return{q:n1+'/'+d+' - '+n2+'/'+d+' = ? Simplify.',a:''+(df/g)+'/'+(d/g),steps:['Diff: '+df+'/'+d,'Simplify: '+(df/g)+'/'+(d/g),'✅ '+(df/g)+'/'+(d/g)]};},];return t[rnd(0,t.length-1)]();}
function gen4_decimals(){var t=[function(){var w=rnd(0,9),t2=rnd(0,9),h=rnd(0,9);return{q:w+' ones, '+t2+' tenths, '+h+' hundredths.\nWrite the decimal.',a:w+'.'+t2+h,steps:['✅ '+w+'.'+t2+h]};},function(){var a=+(rnd(10,50)/10).toFixed(1),b=+(rnd(5,30)/10).toFixed(1);return{q:a+' + '+b+' = ?',a:(a+b).toFixed(1),steps:[a+' + '+b+' = '+(a+b).toFixed(1),'✅ '+(a+b).toFixed(1)]};},function(){var a=+(rnd(20,90)/10).toFixed(1),b=+(rnd(5,15)/10).toFixed(1);return{q:a+' - '+b+' = ?',a:(a-b).toFixed(1),steps:[a+' - '+b+' = '+(a-b).toFixed(1),'✅ '+(a-b).toFixed(1)]};},function(){var n=rnd(1,9);return{q:'Write '+n+'/10 as a decimal.',a:'0.'+n,steps:['✅ 0.'+n]};},];return t[rnd(0,t.length-1)]();}
function gen4_area(){var t=[function(){var l=rnd(3,20),w=rnd(2,l);return{q:'Rectangle '+l+'cm x '+w+'cm.\nArea?',a:''+(l*w)+' cm²',steps:[l+' x '+w+' = '+(l*w)+' cm²','✅ '+(l*w)+' cm²']};},function(){var s=rnd(3,15);return{q:'Square side '+s+'cm.\nArea?',a:''+(s*s)+' cm²',steps:[s+' x '+s+' = '+(s*s)+' cm²','✅ '+(s*s)+' cm²']};},function(){var w=rnd(2,8),l=rnd(w+1,15);return{q:'Rectangle area='+(l*w)+' cm², width='+w+'cm.\nLength?',a:''+l+' cm',steps:[(l*w)+' ÷ '+w+' = '+l+' cm','✅ '+l+' cm']};},];return t[rnd(0,t.length-1)]();}
function gen4_time24(){var t=[function(){var h=rnd(13,23),m=rnd(0,59);return{q:'Convert '+h+':'+String(m).padStart(2,'0')+' (24-hr) to 12-hr.',a:''+(h-12)+':'+String(m).padStart(2,'0')+' pm',steps:[h+' - 12 = '+(h-12),'✅ '+(h-12)+':'+String(m).padStart(2,'0')+' pm']};},function(){var h=rnd(1,11),m=rnd(0,59);return{q:'Convert '+h+':'+String(m).padStart(2,'0')+' pm to 24-hr.',a:''+(h+12)+':'+String(m).padStart(2,'0'),steps:[h+' + 12 = '+(h+12),'✅ '+(h+12)+':'+String(m).padStart(2,'0')]};},function(){var h=rnd(8,11),m=rnd(5,50),dh=rnd(1,3),dm=rnd(5,40);var em=h*60+m+dh*60+dm,eh=Math.floor(em/60)%24,emin=em%60;return{q:'Start: '+h+':'+String(m).padStart(2,'0')+', '+dh+'h '+dm+'min duration.\nFinish (24-hr)?',a:String(eh).padStart(2,'0')+':'+String(emin).padStart(2,'0'),steps:['Total: '+em+' min = '+eh+'h '+emin+'min','✅ '+String(eh).padStart(2,'0')+':'+String(emin).padStart(2,'0')]};},];return t[rnd(0,t.length-1)]();}
function gen4_angles(){var t=[function(){var a=rnd(10,350);var tp=a<90?'acute':a===90?'right angle':a<180?'obtuse':a===180?'straight':'reflex';return{q:'Is '+a+'° acute, right, obtuse, straight or reflex?',a:tp,steps:['✅ '+tp]};},function(){var a=rnd(20,80);return{q:'Complementary angle to '+a+'°?\n(adds to 90°)',a:''+(90-a)+'°',steps:['90 - '+a+' = '+(90-a)+'°','✅ '+(90-a)+'°']};},function(){var a=rnd(10,170);return{q:'Supplementary angle to '+a+'°?\n(adds to 180°)',a:''+(180-a)+'°',steps:['180 - '+a+' = '+(180-a)+'°','✅ '+(180-a)+'°']};},function(){var a=rnd(30,80),b=rnd(30,80),c=180-a-b;return{q:'Triangle: '+a+'° and '+b+'°.\nThird angle?',a:''+c+'°',steps:['180 - '+a+' - '+b+' = '+c+'°','✅ '+c+'°']};},];return t[rnd(0,t.length-1)]();}
function gen5_fractions(){var t=[function(){var d1=rnd(2,6),d2=d1*rnd(2,3),n1=rnd(1,d1-1),n2=rnd(1,d2-1),L=lcm(d1,d2),e1=n1*(L/d1),e2=n2*(L/d2),s=e1+e2,g=gcd(s,L);return{q:n1+'/'+d1+' + '+n2+'/'+d2+' = ? Simplify.',a:''+(s/g)+'/'+(L/g),steps:['LCD='+L,e1+'/'+L+' + '+e2+'/'+L+' = '+s+'/'+L,'Simplify: '+(s/g)+'/'+(L/g),'✅ '+(s/g)+'/'+(L/g)]};},function(){var d=rnd(3,8),w1=rnd(1,4),f1=rnd(1,d-1),w2=rnd(1,4),f2=rnd(1,d-1),n1=w1*d+f1,n2=w2*d+f2,sn=n1+n2,wr=Math.floor(sn/d),rr=sn%d;return{q:w1+' '+f1+'/'+d+' + '+w2+' '+f2+'/'+d+' = ?\nGive as mixed number.',a:(rr===0?''+wr:wr+' '+rr+'/'+d),steps:['Improper: '+n1+'/'+d+' + '+n2+'/'+d+' = '+sn+'/'+d,'Mixed: '+(rr===0?wr:wr+' '+rr+'/'+d),'✅ '+(rr===0?wr:wr+' '+rr+'/'+d)]};},];return t[rnd(0,t.length-1)]();}
function gen5_decimals(){var t=[function(){var a=+(rnd(100,999)/1000).toFixed(3),b=+(rnd(100,499)/1000).toFixed(3);return{q:a+' + '+b+' = ?',a:(a+b).toFixed(3),steps:[a+' + '+b+' = '+(a+b).toFixed(3),'✅ '+(a+b).toFixed(3)]};},function(){var a=+(rnd(10,99)/10).toFixed(1),b=rnd(2,9);return{q:a+' x '+b+' = ?',a:(a*b).toFixed(1),steps:[a+' x '+b+' = '+(a*b).toFixed(1),'✅ '+(a*b).toFixed(1)]};},function(){var a=+(rnd(10,90)/10).toFixed(1),b=rnd(2,5);return{q:a+' ÷ '+b+' = ?',a:(a/b).toFixed(2),steps:[a+' ÷ '+b+' = '+(a/b).toFixed(2),'✅ '+(a/b).toFixed(2)]};},];return t[rnd(0,t.length-1)]();}
function gen5_percentages(){var t=[function(){var p=rnd(1,9)*10,a=rnd(1,10)*10;return{q:'Find '+p+'% of '+a+'.',a:''+(p/100*a),steps:[p+'% = '+p+'/100',a+' x '+p+'/100 = '+(p/100*a),'✅ '+(p/100*a)]};},function(){var p=rnd(1,4)*25,a=rnd(2,8)*4;return{q:'Find '+p+'% of '+a+'.',a:''+(p/100*a),steps:[a+' x '+(p/100)+' = '+(p/100*a),'✅ '+(p/100*a)]};},function(){var n=rnd(1,9);return{q:'Write '+n+'/10 as a percentage.',a:''+(n*10)+'%',steps:[n+'/10 = '+(n*10)+'%','✅ '+(n*10)+'%']};},function(){var p=rnd(2,9)*5;return{q:'Write '+p+'% as a decimal.',a:''+(p/100),steps:[p+'% = '+(p/100),'✅ '+(p/100)]};},];return t[rnd(0,t.length-1)]();}
function gen5_area(){var t=[function(){var b=rnd(4,20),h=rnd(3,15);return{q:'Triangle: base='+b+'cm, height='+h+'cm.\nArea?',a:''+(b*h/2)+' cm²',steps:['½ x '+b+' x '+h+' = '+(b*h/2)+' cm²','✅ '+(b*h/2)+' cm²']};},function(){var b=rnd(4,16),h=rnd(3,12);return{q:'Parallelogram: base='+b+'cm, height='+h+'cm.\nArea?',a:''+(b*h)+' cm²',steps:[b+' x '+h+' = '+(b*h)+' cm²','✅ '+(b*h)+' cm²']};},];return t[rnd(0,t.length-1)]();}
function gen5_coordinates(){var t=[function(){var x=rnd(1,8),y=rnd(1,8),tx=rnd(1,4),ty=rnd(1,4);return{q:'Point A at ('+x+', '+y+').\nMove '+tx+' right, '+ty+' up.\nNew coordinates?',a:'('+(x+tx)+', '+(y+ty)+')',steps:['x: '+x+'+'+tx+'='+(x+tx),'y: '+y+'+'+ty+'='+(y+ty),'✅ ('+(x+tx)+', '+(y+ty)+')']};},function(){var x1=rnd(1,5),y=rnd(1,8),x2=rnd(x1+1,9);return{q:'A('+x1+', '+y+') and B('+x2+', '+y+').\nHorizontal distance?',a:''+(x2-x1)+' units',steps:[x2+'-'+x1+'='+(x2-x1)+' units','✅ '+(x2-x1)+' units']};},function(){var x=rnd(1,9),y=rnd(1,9);return{q:'Point at ('+x+', '+y+'). Both positive.\nWhat quadrant?',a:'First quadrant',steps:['Both positive = First quadrant','✅ First quadrant']};},];return t[rnd(0,t.length-1)]();}
function gen5_probability(){var t=[function(){var tot=rnd(6,20),f=rnd(1,tot-1),g=gcd(f,tot);return{q:'Bag: '+tot+' marbles, '+f+' blue.\nP(blue) simplified?',a:''+(f/g)+'/'+(tot/g),steps:['P(blue)='+f+'/'+tot,'GCD='+g+' → '+(f/g)+'/'+(tot/g),'✅ '+(f/g)+'/'+(tot/g)]};},function(){var d=rnd(4,8),f=rnd(1,d-1),n=rnd(2,5)*d;return{q:'Spinner: '+d+' sections, '+f+' red.\nSpun '+n+' times. Expected reds?',a:''+(f*n/d),steps:['P(red)='+f+'/'+d,'Expected: '+f+'/'+d+' x '+n+'='+(f*n/d),'✅ '+(f*n/d)+' times']};},];return t[rnd(0,t.length-1)]();}
function gen5_statistics(){var n=rnd(5,8),data=[];for(var i=0;i<n;i++)data.push(rnd(20,80));data.sort(function(a,b){return a-b;});var sum=data.reduce(function(s,v){return s+v;},0),mean=(sum/n).toFixed(1),range=data[n-1]-data[0];return{q:'Find mean and range of:\n'+data.join(', '),a:'Mean='+mean+', Range='+range,steps:['Sum='+sum,'Mean='+sum+'/'+n+'='+mean,'Range='+data[n-1]+'-'+data[0]+'='+range,'✅ Mean='+mean+', Range='+range]};}
var YEAR_CURRICULA={
'Prep':{number:{label:'Number',emoji:'🔢',color:'#FF6B6B',accent:'#CC2200',bg:'#FFF4F4',subStrands:{counting:{label:'Counting & Number Sense',emoji:'🔢',topics:{counting:{label:'Counting, Ordering & Adding to 10',acCode:'AC9MFN01',gen:genP_counting},addTo10:{label:'Simple Addition & Subtraction',acCode:'AC9MFN02',gen:genP_counting}}}}},measurement:{label:'Measurement',emoji:'📏',color:'#45B7D1',accent:'#1A7A9A',bg:'#F0F8FF',subStrands:{compare:{label:'Comparing & Ordering',emoji:'⚖️',topics:{compareLength:{label:'Comparing Length, Mass & Capacity',acCode:'AC9MFM01',gen:genP_counting}}}}},geometry:{label:'Geometry',emoji:'🔷',color:'#A29BFE',accent:'#5A4FCF',bg:'#F5F3FF',subStrands:{shapes:{label:'Shapes & Objects',emoji:'🔷',topics:{shapes2D:{label:'2D Shapes — Sides & Corners',acCode:'AC9MFSP01',gen:genP_counting}}}}}},
'Year 1':{number:{label:'Number',emoji:'🔢',color:'#FF6B6B',accent:'#CC2200',bg:'#FFF4F4',subStrands:{placeValue:{label:'Place Value',emoji:'🔢',topics:{placeValue:{label:'Place Value to 100',acCode:'AC9M1N01',gen:gen1_placeValue}}},addSub:{label:'Addition & Subtraction',emoji:'➕',topics:{addSub20:{label:'Addition & Subtraction to 20',acCode:'AC9M1N02',gen:gen1_addSub20},skipCount:{label:'Skip Counting (2s, 5s, 10s)',acCode:'AC9M1N03',gen:gen1_skipCount}}}}},measurement:{label:'Measurement',emoji:'📏',color:'#45B7D1',accent:'#1A7A9A',bg:'#F0F8FF',subStrands:{time:{label:'Time',emoji:'⏱️',topics:{time:{label:"Days, Months & O'Clock Time",acCode:'AC9M1M02',gen:gen1_time}}}}},geometry:{label:'Geometry',emoji:'🔷',color:'#A29BFE',accent:'#5A4FCF',bg:'#F5F3FF',subStrands:{shapes:{label:'2D Shapes',emoji:'🔷',topics:{shapes:{label:'Shape Properties',acCode:'AC9M1SP01',gen:gen1_shapes}}}}}},
'Year 2':{number:{label:'Number',emoji:'🔢',color:'#FF6B6B',accent:'#CC2200',bg:'#FFF4F4',subStrands:{placeValue:{label:'Place Value',emoji:'🔢',topics:{placeValue:{label:'Place Value to 1000',acCode:'AC9M2N01',gen:gen2_placeValue}}},multiplication:{label:'Multiplication',emoji:'✖️',topics:{multiply:{label:'Multiplication as Groups & Arrays',acCode:'AC9M2N03',gen:gen2_multiply}}},fractions:{label:'Fractions',emoji:'🍕',topics:{fractions:{label:'Halves & Quarters',acCode:'AC9M2N04',gen:gen2_fractions}}}}},measurement:{label:'Measurement',emoji:'📏',color:'#45B7D1',accent:'#1A7A9A',bg:'#F0F8FF',subStrands:{time:{label:'Time',emoji:'⏱️',topics:{time:{label:'Time to Quarter Hour',acCode:'AC9M2M02',gen:gen2_time}}},length:{label:'Length',emoji:'📏',topics:{length:{label:'Measuring in cm and m',acCode:'AC9M2M01',gen:gen2_length}}}}}},
'Year 3':{number:{label:'Number',emoji:'🔢',color:'#FF6B6B',accent:'#CC2200',bg:'#FFF4F4',subStrands:{placeValue:{label:'Place Value',emoji:'🔢',topics:{placeValue:{label:'Place Value to 10 000',acCode:'AC9M3N01',gen:gen3_placeValue}}},multiplication:{label:'Multiplication & Division',emoji:'✖️',topics:{multiply:{label:'Times Tables & Division Facts',acCode:'AC9M3N02',gen:gen3_multiply}}},fractions:{label:'Fractions',emoji:'🍕',topics:{fractions:{label:'Thirds, Quarters, Sixths & Eighths',acCode:'AC9M3N04',gen:gen3_fractions}}}}},measurement:{label:'Measurement',emoji:'📏',color:'#45B7D1',accent:'#1A7A9A',bg:'#F0F8FF',subStrands:{perimeter:{label:'Perimeter',emoji:'📏',topics:{perimeter:{label:'Perimeter of 2D Shapes',acCode:'AC9M3M01',gen:gen3_perimeter}}}}},geometry:{label:'Geometry',emoji:'📏',color:'#A29BFE',accent:'#5A4FCF',bg:'#F5F3FF',subStrands:{angles:{label:'Angles',emoji:'∠',topics:{angles:{label:'Right, Acute & Obtuse Angles',acCode:'AC9M3SP01',gen:gen3_angles}}}}}},
'Year 4':{number:{label:'Number',emoji:'🔢',color:'#FF6B6B',accent:'#CC2200',bg:'#FFF4F4',subStrands:{placeValue:{label:'Large Numbers',emoji:'🔢',topics:{placeValue:{label:'Place Value to Millions',acCode:'AC9M4N01',gen:gen4_placeValue}}},multiplyDivide:{label:'Multiplication & Division',emoji:'✖️',topics:{multiply:{label:'Multi-Digit Multiplication',acCode:'AC9M4N02',gen:gen4_multiply},divide:{label:'Division with Remainders',acCode:'AC9M4N02',gen:gen4_divide}}},fractions:{label:'Fractions & Decimals',emoji:'🍕',topics:{fractions:{label:'Equivalent Fractions & Operations',acCode:'AC9M4N04',gen:gen4_fractions},decimals:{label:'Tenths & Hundredths',acCode:'AC9M4N05',gen:gen4_decimals}}}}},measurement:{label:'Measurement',emoji:'📏',color:'#45B7D1',accent:'#1A7A9A',bg:'#F0F8FF',subStrands:{area:{label:'Area',emoji:'📏',topics:{area:{label:'Area of Rectangles & Squares',acCode:'AC9M4M01',gen:gen4_area}}},time:{label:'Time',emoji:'⏱️',topics:{time24:{label:'12-Hour & 24-Hour Time',acCode:'AC9M4M03',gen:gen4_time24}}}}},geometry:{label:'Geometry',emoji:'📏',color:'#A29BFE',accent:'#5A4FCF',bg:'#F5F3FF',subStrands:{angles:{label:'Angles',emoji:'∠',topics:{angles:{label:'Measuring & Classifying Angles',acCode:'AC9M4SP01',gen:gen4_angles}}}}}},
'Year 5':{number:{label:'Number',emoji:'🔢',color:'#FF6B6B',accent:'#CC2200',bg:'#FFF4F4',subStrands:{fractions:{label:'Fractions',emoji:'🍕',topics:{fractions:{label:'Add & Subtract Fractions (Related Denominators)',acCode:'AC9M5N04',gen:gen5_fractions}}},decimals:{label:'Decimals',emoji:'🔣',topics:{decimals:{label:'Decimal Operations to Thousandths',acCode:'AC9M5N05',gen:gen5_decimals}}},percentages:{label:'Percentages',emoji:'💯',topics:{percentages:{label:'Percentages of Amounts',acCode:'AC9M5N06',gen:gen5_percentages}}}}},measurement:{label:'Measurement',emoji:'📏',color:'#45B7D1',accent:'#1A7A9A',bg:'#F0F8FF',subStrands:{area:{label:'Area',emoji:'📏',topics:{area:{label:'Area of Triangles & Parallelograms',acCode:'AC9M5M01',gen:gen5_area}}}}},geometry:{label:'Geometry',emoji:'📏',color:'#A29BFE',accent:'#5A4FCF',bg:'#F5F3FF',subStrands:{coordinates:{label:'Coordinates',emoji:'🗺️',topics:{coordinates:{label:'Coordinates in the First Quadrant',acCode:'AC9M5SP02',gen:gen5_coordinates}}}}},statistics:{label:'Statistics',emoji:'📊',color:'#FD79A8',accent:'#C0145A',bg:'#FFF0F6',subStrands:{data:{label:'Data & Averages',emoji:'📈',topics:{statistics:{label:'Mean, Median & Range',acCode:'AC9M5ST01',gen:gen5_statistics}}}}},probability:{label:'Probability',emoji:'🎲',color:'#FDCB6E',accent:'#B8860B',bg:'#FFFBF0',subStrands:{chance:{label:'Probability',emoji:'🎯',topics:{probability:{label:'Simple Probability as Fractions',acCode:'AC9M5P01',gen:gen5_probability}}}}}},
'Year 6':null};
YEAR_CURRICULA['Year 6']=CURRICULUM;
ACTIVE_CURRICULUM=CURRICULUM;

function changeYearLevel(year){
  CURRENT_YEAR=year;
  try{localStorage.setItem('mmSelectedYear',year);}catch(e){}
  ACTIVE_CURRICULUM=YEAR_CURRICULA[year]||CURRICULUM;
  var logo=document.getElementById('nav-logo');
  if(logo)logo.innerHTML='🎓 Maths Master Snr '+year;
  document.title='Maths Master Snr '+year+' — Queensland Curriculum';
  var sel=document.getElementById('year-level-select');
  if(sel&&sel.value!==year)sel.value=year;
  if(VIEW==='dashboard'||VIEW==='strand'||VIEW==='tt-hub')showDashboard();
}


// Boot
(function(){
  try{
    var saved=localStorage.getItem('mmSelectedYear');
    var valid=['Prep','Year 1','Year 2','Year 3','Year 4','Year 5','Year 6'];
    if(saved&&valid.indexOf(saved)!==-1){
      CURRENT_YEAR=saved;
      ACTIVE_CURRICULUM=YEAR_CURRICULA[saved]||CURRICULUM;
      var sel=document.getElementById('year-level-select');
      if(sel)sel.value=saved;
      var logo=document.getElementById('nav-logo');
      if(logo)logo.innerHTML='🎓 Maths Master Snr '+saved;
      document.title='Maths Master Snr '+saved+' — Queensland Curriculum';
    }
  }catch(e){}
})();
showDashboard();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js'));
}



// MATHS MASTER SNR V2 EXPERIENCE
let SNR_MODE=localStorage.getItem('snrMode')||'study';
function buildSeniorCommandBar(){
  const completed=parseInt(localStorage.getItem('snrCompleted')||'0');
  const best=parseInt(localStorage.getItem('snrBest')||'0');
  return `<section class="command-centre">
    <div class="command-top"><div><div class="eyebrow">LEARNING MODE</div><h2>Set your session focus</h2></div>
    <div class="mode-switch" role="group" aria-label="Learning mode">
      <button class="mode-option ${SNR_MODE==='study'?'active':''}" onclick="setSnrMode('study')">Study</button>
      <button class="mode-option ${SNR_MODE==='exam'?'active':''}" onclick="setSnrMode('exam')">Exam</button>
    </div></div>
    <div class="command-grid">
      <button class="command-card" onclick="startNextRecommended()"><span class="command-icon">→</span><span><strong>Continue practice</strong><small>Open a recommended topic for ${CURRENT_YEAR}</small></span></button>
      <button class="command-card" onclick="showFormulaReference()"><span class="command-icon">ƒ</span><span><strong>Formula reference</strong><small>Review essential rules and notation</small></span></button>
      <div class="command-stat"><strong>${completed}</strong><small>Sessions completed</small></div>
      <div class="command-stat"><strong>${best}%</strong><small>Best result</small></div>
    </div>
    <p class="mode-description">${SNR_MODE==='exam'?'Exam mode provides one attempt per question and keeps worked solutions hidden until the response is submitted.':'Study mode provides up to three attempts and step by step support.'}</p>
  </section>`;
}
function setSnrMode(mode){SNR_MODE=mode;localStorage.setItem('snrMode',mode);MAX_ATTEMPTS=mode==='exam'?1:3;showDashboard();}
function startNextRecommended(){const first=Object.keys(ACTIVE_CURRICULUM)[0];showStrand(first);}
function showFormulaReference(){
 const content=CURRENT_YEAR==='Year 7'||CURRENT_YEAR==='Year 8'||CURRENT_YEAR==='Year 9'||CURRENT_YEAR==='Year 10'
 ?['Index laws: aᵐ × aⁿ = aᵐ⁺ⁿ','Gradient: m = (y₂ − y₁)/(x₂ − x₁)','Pythagoras: c² = a² + b²','Circle: C = 2πr and A = πr²','Probability: P(A) = favourable outcomes / total outcomes']
 :['Compound interest: A = P(1 + r)ⁿ','Arithmetic sequence: tₙ = a + (n − 1)d','Binomial mean: E(X) = np','Differentiation: d/dx(xⁿ) = nxⁿ⁻¹','Trigonometry: sin²θ + cos²θ = 1'];
 const ov=document.createElement('div');ov.className='modal-overlay';ov.id='formula-modal';ov.innerHTML=`<div class="modal-card formula-card"><div class="eyebrow">REFERENCE</div><h2>Essential formulas</h2><p>${CURRENT_YEAR} quick reference</p><div class="formula-list">${content.map(x=>`<div>${x}</div>`).join('')}</div><button class="modal-btn modal-btn-primary" onclick="document.getElementById('formula-modal').remove()">Close reference</button></div>`;document.body.appendChild(ov);
}
const _snrShowSessionEnd=showSessionEnd;
showSessionEnd=function(){const result=Math.round((CORRECT/TOTAL_Q)*100);localStorage.setItem('snrCompleted',parseInt(localStorage.getItem('snrCompleted')||'0')+1);localStorage.setItem('snrBest',Math.max(result,parseInt(localStorage.getItem('snrBest')||'0')));_snrShowSessionEnd();};

// SECONDARY CURRICULUM MODULE - Queensland 2026
function qObj(q,a,steps){return {q:q,a:String(a),steps:steps||['Apply the relevant rule or formula.','Substitute the known values.','Calculate and check the result.','✅ '+a]};}
function pick(a){return a[rnd(0,a.length-1)]();}
function g7Number(){return pick([
()=>{let n=rnd(4,15);return qObj('Find the square of '+n+'.',n*n,['Square means multiply the number by itself.',n+' × '+n+' = '+n*n,'✅ '+n*n]);},
()=>{let p=[2,3,5,7][rnd(0,3)],q=[2,3,5][rnd(0,2)],n=p*p*q;return qObj('Write '+n+' as a product of prime factors using exponent notation.',p===q?p+'³':p+'² × '+q,['Divide by prime numbers.',n+' = '+p+' × '+p+' × '+q,'✅ '+(p===q?p+'³':p+'² × '+q)]);},
()=>{let a=rnd(-20,10),b=rnd(-15,15);return qObj('Calculate: '+a+' + ('+b+')',a+b,['Use the integer number line.','Start at '+a+' and move '+Math.abs(b)+' '+(b>=0?'right':'left')+'.','✅ '+(a+b)]);},
()=>{let x=rnd(2,12),r=rnd(2,8);return qObj('Simplify the ratio '+(x*r)+':'+(r*r)+'.',x+':'+r,['Find the highest common factor: '+r+'.','Divide both terms by '+r+'.','✅ '+x+':'+r]);}]);}
function g7Algebra(){return pick([
()=>{let x=rnd(2,12),a=rnd(2,8),b=rnd(1,12);return qObj('Solve: '+a+'x + '+b+' = '+(a*x+b),x,['Subtract '+b+' from both sides.','Divide both sides by '+a+'.','✅ x = '+x]);},
()=>{let x=rnd(2,9),a=rnd(2,7),b=rnd(1,9);return qObj('Evaluate '+a+'x + '+b+' when x = '+x+'.',a*x+b,['Substitute x = '+x+'.',a+' × '+x+' + '+b+' = '+(a*x+b),'✅ '+(a*x+b)]);},
()=>{let a=rnd(2,7),b=rnd(1,9);return qObj('Write an algebraic expression for: '+b+' more than '+a+' times n.',a+'n + '+b,['“Times n” gives '+a+'n.','“More than” means add '+b+'.','✅ '+a+'n + '+b]);}]);}
function g7Measure(){return pick([
()=>{let b=rnd(4,18),h=rnd(3,14);return qObj('Find the area of a triangle with base '+b+' cm and perpendicular height '+h+' cm.',b*h/2,['A = ½bh.','A = ½ × '+b+' × '+h+'.','✅ '+b*h/2+' cm²']);},
()=>{let l=rnd(4,12),w=rnd(3,9),h=rnd(2,8);return qObj('Find the volume of a rectangular prism '+l+' cm × '+w+' cm × '+h+' cm.',l*w*h,['V = lwh.','V = '+l+' × '+w+' × '+h+'.','✅ '+l*w*h+' cm³']);},
()=>{let a=rnd(25,75);return qObj('Two parallel lines are crossed by a transversal. An alternate angle is '+a+'°. Find the matching alternate angle.',a,['Alternate angles between parallel lines are equal.','✅ '+a+'°']);}]);}
function g8Number(){return pick([
()=>{let a=rnd(2,6),m=rnd(2,5),n=rnd(1,4);return qObj('Simplify '+a+'^'+m+' × '+a+'^'+n+'.',a+'^'+(m+n),['Same base: add exponents.',m+' + '+n+' = '+(m+n)+'.','✅ '+a+'^'+(m+n)]);},
()=>{let n=[2,3,5,6,7,8,10][rnd(0,6)];return qObj('Is √'+n+' rational or irrational?','irrational',['Only square roots of perfect squares are rational integers.','✅ irrational']);},
()=>{let a=rnd(-12,12),b=rnd(-12,12);return qObj('Calculate: '+a+' × ('+b+')',a*b,['Determine the sign, then multiply magnitudes.','✅ '+a*b]);}]);}
function g8Algebra(){return pick([
()=>{let x=rnd(-5,10),a=rnd(2,7),b=rnd(-9,9);return qObj('Solve: '+a+'x '+(b>=0?'+ ':'− ')+Math.abs(b)+' = '+(a*x+b),x,['Undo the constant term.','Divide by '+a+'.','✅ x = '+x]);},
()=>{let a=rnd(2,6),b=rnd(1,8);return qObj('Expand: '+a+'(x + '+b+')',a+'x + '+a*b,['Use the distributive property.','Multiply '+a+' by each term.','✅ '+a+'x + '+a*b]);},
()=>{let m=rnd(1,6),c=rnd(-5,8),x=rnd(2,9);return qObj('For y = '+m+'x '+(c>=0?'+ ':'− ')+Math.abs(c)+', find y when x = '+x+'.',m*x+c,['Substitute x = '+x+'.','✅ y = '+(m*x+c)]); }]);}
function g8Measure(){return pick([
()=>{let r=rnd(2,12);return qObj('Find the circumference of a circle with radius '+r+' cm. Use π = 3.14.',(2*3.14*r).toFixed(2),['C = 2πr.','C = 2 × 3.14 × '+r+'.','✅ '+(2*3.14*r).toFixed(2)+' cm']);},
()=>{let a=rnd(3,12),b=rnd(4,15),c=Math.sqrt(a*a+b*b); if(!Number.isInteger(c)){a=3;b=4;c=5;} return qObj('A right triangle has shorter sides '+a+' cm and '+b+' cm. Find the hypotenuse.',c,['c² = a² + b².','c = √('+(a*a)+' + '+(b*b)+').','✅ '+c+' cm']);},
()=>{let d=rnd(2,10),h=rnd(1,4),m=rnd(0,45);let total=h*60+m;return qObj('A trip lasts '+h+' h '+m+' min. Express the duration in minutes.',total,['1 hour = 60 minutes.',h+' × 60 + '+m+' = '+total+'.','✅ '+total+' minutes']);}]);}
function g9Algebra(){return pick([
()=>{let p=rnd(1,8),q=rnd(1,8);return qObj('Expand: (x + '+p+')(x + '+q+')','x² + '+(p+q)+'x + '+p*q,['Multiply each term.','Combine like terms.','✅ x² + '+(p+q)+'x + '+p*q]);},
()=>{let p=rnd(1,8),q=rnd(1,8);return qObj('Factorise: x² + '+(p+q)+'x + '+p*q,'(x + '+p+')(x + '+q+')',['Find two numbers that add to '+(p+q)+' and multiply to '+p*q+'.','✅ (x + '+p+')(x + '+q+')']);},
()=>{let x1=rnd(-5,4),y1=rnd(-5,4),x2=x1+rnd(2,8),y2=y1+rnd(2,8);return qObj('Find the midpoint of ('+x1+', '+y1+') and ('+x2+', '+y2+').','('+((x1+x2)/2)+', '+((y1+y2)/2)+')',['Average the x-coordinates and y-coordinates.','✅ ('+((x1+x2)/2)+', '+((y1+y2)/2)+')']);}]);}
function g9Measure(){return pick([
()=>{let r=rnd(2,8),h=rnd(3,12);return qObj('Find the volume of a cylinder with radius '+r+' cm and height '+h+' cm. Use π = 3.14.',(3.14*r*r*h).toFixed(2),['V = πr²h.','Substitute the values.','✅ '+(3.14*r*r*h).toFixed(2)+' cm³']);},
()=>{let opp=rnd(3,12),adj=rnd(3,12);return qObj('For a right triangle, opposite = '+opp+' and adjacent = '+adj+'. Find tan θ to 2 decimal places.',(opp/adj).toFixed(2),['tan θ = opposite ÷ adjacent.','✅ '+(opp/adj).toFixed(2)]);},
()=>{let v=rnd(2,9)*1000000;return qObj('Write '+v.toLocaleString()+' in scientific notation.',(v/1000000)+' × 10⁶',['Move the decimal point 6 places.','✅ '+(v/1000000)+' × 10⁶']);}]);}
function g10Algebra(){return pick([
()=>{let x=rnd(1,6),y=rnd(1,6),a=rnd(1,5),b=rnd(1,5);return qObj('Solve simultaneously: x + y = '+(x+y)+' and x − y = '+(x-y)+'. Enter x, y.',x+', '+y,['Add the equations to eliminate y.','Solve for x, then substitute for y.','✅ '+x+', '+y]);},
()=>{let base=rnd(2,5),power=rnd(2,5);return qObj('Solve: '+base+'^x = '+(base**power)+'.',power,['Express both sides with the same base.','✅ x = '+power]);},
()=>{let p=rnd(1,7),q=rnd(1,7);return qObj('Solve x² − '+(p+q)+'x + '+p*q+' = 0. Enter both solutions.',p+', '+q,['Factorise: (x − '+p+')(x − '+q+') = 0.','✅ x = '+p+' or '+q]);}]);}
function g10Measure(){return pick([
()=>{let a=rnd(20,70),h=rnd(5,20);return qObj('From a point '+h+' m from a building, the angle of elevation is '+a+'°. Write the expression used to find height hᵦ.','hᵦ = '+h+' tan('+a+'°)',['tan θ = opposite/adjacent.','Rearrange for the opposite side.','✅ hᵦ = '+h+' tan('+a+'°)']);},
()=>{let actual=rnd(50,200),err=rnd(1,10);return qObj('A measurement is '+actual+' cm with absolute error '+err+' cm. Find the percentage error to 2 decimal places.',(err/actual*100).toFixed(2),['Percentage error = absolute error ÷ measured value × 100.','✅ '+(err/actual*100).toFixed(2)+'%']);},
()=>{let r=rnd(2,7),h=rnd(4,12);return qObj('Find the total surface area of a closed cylinder with r = '+r+' cm and h = '+h+' cm. Use π = 3.14.',(2*3.14*r*r+2*3.14*r*h).toFixed(2),['TSA = 2πr² + 2πrh.','✅ '+(2*3.14*r*r+2*3.14*r*h).toFixed(2)+' cm²']);}]);}
function gStats(y){return pick([
()=>{let d=[rnd(5,15),rnd(16,25),rnd(26,35),rnd(36,45),rnd(46,55)];let mean=d.reduce((a,b)=>a+b,0)/5;return qObj('Find the mean of: '+d.join(', '),mean,['Add the values and divide by 5.','✅ '+mean]);},
()=>{let total=rnd(40,100),fav=rnd(10,total-10);return qObj('In a sample of '+total+', '+fav+' meet the criterion. Find the sample proportion to 2 decimal places.',(fav/total).toFixed(2),['Proportion = favourable ÷ total.','✅ '+(fav/total).toFixed(2)]);}]);}
function gProb(y){return pick([
()=>{let n=rnd(6,20),f=rnd(1,n-1);let g=gcd(f,n);return qObj('An event has '+f+' favourable outcomes from '+n+' equally likely outcomes. Find the probability in simplest form.',(f/g)+'/'+(n/g),['P = favourable ÷ total.','Simplify the fraction.','✅ '+(f/g)+'/'+(n/g)]);},
()=>{let p=rnd(1,8)/10;return qObj('If P(A) = '+p.toFixed(1)+', find P(not A).',(1-p).toFixed(1),['Complementary probabilities sum to 1.','✅ '+(1-p).toFixed(1)]);}]);}
function strand(label,emoji,color,accent,bg,topics){return {label,emoji,color,accent,bg,subStrands:{practice:{label:label+' topics',emoji,topics}}};}
function topic(label,code,gen){return {label,acCode:code,gen};}
function lowerYear(y){let ys=String(y);let na=y===7?g7Number:y===8?g8Number:y===9?g9Algebra:g10Algebra;let alg=y===7?g7Algebra:y===8?g8Algebra:y===9?g9Algebra:g10Algebra;let mea=y===7?g7Measure:y===8?g8Measure:y===9?g9Measure:g10Measure;return {
 number:strand('Number','🔢','#FF6B6B','#CC2200','#FFF4F4',{core:topic(y===7?'Rational numbers, integers, ratios and indices':y===8?'Real numbers, exponents and rational operations':'Real numbers and numerical reasoning','AC9M'+ys+'N',na)}),
 algebra:strand('Algebra','🔡','#4ECDC4','#1A8A82','#F0FFFD',{core:topic(y===7?'Variables, formulas and linear equations':y===8?'Linear expressions, equations and graphs':y===9?'Quadratics and coordinate geometry':'Equations, inequalities and exponential relations','AC9M'+ys+'A',alg)}),
 measurement:strand('Measurement','📏','#45B7D1','#1A7A9A','#F0F8FF',{core:topic(y===7?'Area, volume and angle relationships':y===8?'Circles, time, rates and Pythagoras':y===9?'Prisms, cylinders, scientific notation and trigonometry':'Surface area, volume, error and trigonometry','AC9M'+ys+'M',mea)}),
 space:strand('Space','📐','#A29BFE','#5A4FCF','#F5F3FF',{core:topic('Spatial reasoning and transformations','AC9M'+ys+'SP',mea)}),
 statistics:strand('Statistics','📊','#FD79A8','#C0145A','#FFF0F6',{core:topic('Data, sampling and statistical investigations','AC9M'+ys+'ST',()=>gStats(y))}),
 probability:strand('Probability','🎲','#FDCB6E','#B8860B','#FFFBF0',{core:topic('Chance, compound events and probability','AC9M'+ys+'P',()=>gProb(y))})};}
function seniorGen(kind){return pick([
()=>{let p=rnd(1000,9000),r=rnd(2,8)/100,t=rnd(2,6);return qObj('Compound interest: P = $'+p+', r = '+(r*100)+'% p.a., n = '+t+' years. Find A to the nearest cent.',(p*Math.pow(1+r,t)).toFixed(2),['Use A = P(1 + r)ⁿ.','Substitute the values.','✅ $'+(p*Math.pow(1+r,t)).toFixed(2)]);},
()=>{let m=rnd(2,7),c=rnd(-8,8),x=rnd(2,10);return qObj('For f(x) = '+m+'x '+(c>=0?'+ ':'− ')+Math.abs(c)+', find f('+x+').',m*x+c,['Substitute x = '+x+'.','✅ '+(m*x+c)]);},
()=>{let n=rnd(5,10),p=rnd(1,8)/10;return qObj('For X ~ Bin('+n+', '+p.toFixed(1)+'), find the expected value E(X).',(n*p).toFixed(1),['For a binomial variable, E(X) = np.','✅ '+(n*p).toFixed(1)]);},
()=>{let a=rnd(1,5),x=rnd(1,6);return qObj('Differentiate f(x) = '+a+'x² + '+rnd(1,8)+'x. Find f\'(x).',(2*a)+'x + constant coefficient',['Use the power rule.','The derivative of '+a+'x² is '+(2*a)+'x.','Differentiate the linear term as its coefficient.']);}]);}
function seniorYear(y){let subjects=['Essential Mathematics','General Mathematics','Mathematical Methods','Specialist Mathematics'];let out={};subjects.forEach((s,i)=>{let key=['essential','general','methods','specialist'][i];let colors=['#FF9F43','#45B7D1','#6C5CE7','#00B894'];out[key]=strand(s,['🧮','📊','∫','Σ'][i],colors[i],colors[i],'#F7F7FF',{unit1:topic('Units 1–2 practice','QCAA 2025 syllabus',()=>seniorGen(key)),unit2:topic('Units 3–4 practice','QCAA 2025 syllabus',()=>seniorGen(key))});});return out;}
const SECONDARY_CURRICULA={'Year 7':lowerYear(7),'Year 8':lowerYear(8),'Year 9':lowerYear(9),'Year 10':lowerYear(10),'Year 11':seniorYear(11),'Year 12':seniorYear(12)};
function changeSecondaryYear(year){CURRENT_YEAR=year;ACTIVE_CURRICULUM=SECONDARY_CURRICULA[year];try{localStorage.setItem('mmSecondaryYear',year);}catch(e){};let logo=$('nav-logo');if(logo)logo.textContent='🎓 Maths Master Snr '+year;document.title='Maths Master Snr '+year+' - Queensland 2026';showDashboard();}
(function bootSecondary(){let sel=$('year-level-select');let saved=localStorage.getItem('mmSecondaryYear')||'Year 7';if(sel)sel.value=saved;changeSecondaryYear(saved);})();

showBonusNotification=function(){return;};
openParentPinModal=function(){return;};
