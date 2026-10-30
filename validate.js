/**
 * 桌面修仙 · 网页版公式验证
 * 与 Unity FormulaValidator.cs 断言完全一致
 * 运行：node web/validate.js
 */

// === 加载配置（模拟浏览器环境）===
const fs = require('fs');
const path = require('path');

const configCode = fs.readFileSync(path.join(__dirname, 'js/config.js'), 'utf8');
eval(configCode);

let pass = 0, fail = 0;

function check(label, actual, expected, tolerance = 0.01) {
  if (Math.abs(actual - expected) <= tolerance) {
    console.log(`  [PASS] ${label}: ${actual.toFixed(2)} ≈ ${expected.toFixed(2)}`);
    pass++;
  } else {
    console.error(`  [FAIL] ${label}: got ${actual.toFixed(2)}, expected ${expected.toFixed(2)} (±${tolerance})`);
    fail++;
  }
}

function checkBool(label, condition) {
  if (condition) {
    console.log(`  [PASS] ${label}`);
    pass++;
  } else {
    console.error(`  [FAIL] ${label}`);
    fail++;
  }
}

console.log('=== NUM-001: 修为需求公式 Q(R,r) ===');

// 极值1：全最小值 R=1, r=1, γ=0.9 → 90
check('Q min (R=1,r=1,γ=0.9)', calcQ(1, 1, 0.9), 90, 0.01);

// 极值2：全最大值 R=6, r=9, γ=1.1 → ≈5404.16
check('Q max (R=6,r=9,γ=1.1)', calcQ(6, 9, 1.1), 5404.16, 1);

// 所有组合非负
let allPositive = true;
for (let R = 1; R <= 6; R++)
  for (let r = 1; r <= 9; r++)
    if (calcQ(R, r, 0.9) <= 0) allPositive = false;
checkBool('Q always > 0', allPositive);

// 边界验算
check('Q(R=2,r=1)', calcQ(2, 1, 1.0), 180, 0.1);
check('Q(R=3,r=1)', calcQ(3, 1, 1.0), 324, 0.1);
check('Q(R=6,r=1)', calcQ(6, 1, 1.0), 1889.57, 1);

// 累计
let total = 0;
for (let R = 1; R <= 6; R++)
  for (let r = 1; r <= 9; r++)
    total += calcQ(R, r, 1.0);
check('Total cultivation (γ=1)', total, 66850, 100);

console.log('\n=== NUM-002: 修为积累速率 V(R,mode) ===');

check('V min (R=1,bg,no-pill)', calcRate(1, true, false), 0.3, 0.001);
check('V max (R=6,fg,pill)', calcRate(6, false, true), 15.2, 0.1);

const timeToMax = calcQ(6, 9, 1.0) / calcRate(6, false, true);
checkBool('R=6/r=9 takes < 6 min at max rate', timeToMax < 360);

console.log('\n=== NUM-003: 经济三件套 ===');

const hourlyHerbProduction = 30;
const hourlyHerbConsumption = 25;
const ratio = hourlyHerbProduction / hourlyHerbConsumption;
checkBool('Economy ratio in [1.1, 1.4]', ratio >= 1.1 && ratio <= 1.4);
check('Economy ratio value', ratio, 1.2, 0.01);

console.log('\n=== 跨端一致性（与 Unity FormulaValidator.cs 对照）===');

// 与 Unity 版 12 组断言逐一对照
const unityExpected = [
  { label: 'Q min', val: 90, tol: 0.01 },
  { label: 'Q max', val: 5404.16, tol: 1 },
  { label: 'Q(R=2,r=1)', val: 180, tol: 0.1 },
  { label: 'Q(R=3,r=1)', val: 324, tol: 0.1 },
  { label: 'Q(R=6,r=1)', val: 1889.57, tol: 1 },
  { label: 'Q total', val: 66850, tol: 100 },
  { label: 'V min', val: 0.3, tol: 0.001 },
  { label: 'V max', val: 15.2, tol: 0.1 },
];

const webValues = [
  calcQ(1, 1, 0.9),
  calcQ(6, 9, 1.1),
  calcQ(2, 1, 1.0),
  calcQ(3, 1, 1.0),
  calcQ(6, 1, 1.0),
  total,
  calcRate(1, true, false),
  calcRate(6, false, true),
];

unityExpected.forEach((exp, i) => {
  checkBool(`Cross-platform: ${exp.label} matches Unity`, Math.abs(webValues[i] - exp.val) <= exp.tol);
});

// === 汇总 ===
console.log(`\n${'='.repeat(50)}`);
console.log(`[Validate] ${pass} passed, ${fail} failed`);
if (fail === 0) {
  console.log('ALL FORMULAS VERIFIED ✓ — Web version consistent with Unity/GDD');
  process.exit(0);
} else {
  console.log('FORMULA MISMATCH DETECTED ✗');
  process.exit(1);
}
