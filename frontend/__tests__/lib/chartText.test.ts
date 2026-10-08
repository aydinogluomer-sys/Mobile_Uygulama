/**
 * R07.07 — "Sayısal fixture, erişilebilir grafik metni ... 'Birlikte
 * görülüyor' ile neden-sonuç iddiasını ayır; paylaşım öncesi özel içerik
 * seçimi olsun." (User comprehension test: N/R, S8.)
 */
import * as fs from 'fs';
import * as path from 'path';
import { seriesText, heatmapText, radarText, redactSessionsForShare, CAUSAL_WORDS } from '../../lib/chartText';

describe('numeric fixtures -> exact text', () => {
  it('a series: highest, lowest, total, average (Turkish decimal comma)', () => {
    expect(seriesText('Son 7 gün', [
      { label: 'Pzt', value: 0 }, { label: 'Sal', value: 8 }, { label: 'Çar', value: 3 }, { label: 'Per', value: 5 },
      { label: 'Cum', value: 2 }, { label: 'Cmt', value: 7 }, { label: 'Paz', value: 1 },
    ], 'dk')).toBe('Son 7 gün: en yüksek Sal (8 dk), en düşük Pzt (0 dk), toplam 26 dk, ortalama 3,7 dk.');
  });
  it('the lowest point is found wherever it is', () => {
    expect(seriesText('S', [{ label: 'a', value: 5 }, { label: 'b', value: 1 }, { label: 'c', value: 3 }])).toBe('S: en yüksek a (5), en düşük b (1), toplam 9, ortalama 3.');
  });
  it('all zero and empty are said plainly', () => {
    expect(seriesText('X', [{ label: 'a', value: 0 }, { label: 'b', value: 0 }])).toBe('X: 2 noktanın hepsi sıfır.');
    expect(seriesText('X', [])).toBe('X: veri yok.');
  });
  it('a heatmap: active days, best day, longest run', () => {
    expect(heatmapText('Yıllık aktivite', [0, 0.5, 1, 0, 0.25], 2)).toBe('Yıllık aktivite: 5 günün 3\'inde tamamlama var, en yüksek gün %100, en uzun seri 2 gün.');
    expect(heatmapText('Yıllık aktivite', [0, 0], 0)).toBe('Yıllık aktivite: 2 günde kayıt yok.');
  });
  it('the radar names every area and the strongest/weakest', () => {
    expect(radarText([{ label: 'Sağlık', value: 7 }, { label: 'Kariyer', value: 4.5 }, { label: 'Eğitim', value: 9 }]))
      .toBe('Yaşam alanları (10 üzerinden): Sağlık 7, Kariyer 4,5, Eğitim 9. En güçlü Eğitim, en zayıf Kariyer.');
  });
});

describe('description, not causation', () => {
  it('no chart text claims a cause', () => {
    const outs = [
      seriesText('a', [{ label: 'x', value: 1 }, { label: 'y', value: 3 }]),
      heatmapText('b', [1, 0.3], 1), radarText([{ label: 'A', value: 1 }]),
    ];
    for (const o of outs) expect(o).not.toMatch(CAUSAL_WORDS);
    expect('uyku eksikliği yüzünden').toMatch(CAUSAL_WORDS); // the detector works
  });
  it('the mood–habit card keeps saying "together", not "because"', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../components/MoodHabitCard.tsx'), 'utf8');
    expect(src).not.toMatch(CAUSAL_WORDS);
  });
});

describe('private content before sharing', () => {
  const rows = [{ task_title: 'Boşanma dilekçesi', mode: 'work' }, { task_title: null, mode: 'work' }];
  it('task titles are left out unless chosen; times and modes stay', () => {
    expect(redactSessionsForShare(rows, false)).toEqual([{ task_title: 'Görev', mode: 'work' }, { task_title: null, mode: 'work' }]);
    expect(redactSessionsForShare(rows, true)).toEqual(rows);
  });
});
