const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

async function exportCatalog() {
  const pool = mysql.createPool({
    host: '127.0.0.1',
    user: 'root',
    password: '',
    database: 'order_management',
    waitForConnections: true,
    connectionLimit: 5
  });

  try {
    const [rows] = await pool.query('SELECT id, code, name, unit_type, items_per_carton FROM products ORDER BY code ASC;');
    console.log(`Retrieved ${rows.length} products from MySQL.`);

    // Categorize
    const categorized = rows.map(r => {
      let category = 'أخرى ومستلزمات';
      const n = r.name;
      if (n.includes('كوب') || n.includes('كأس')) category = 'أكواب (ورقية / بلاستيك / كرافت)';
      else if (n.includes('طبق') || n.includes('فوم') || n.includes('ريزو')) category = 'أطباق وتغليف (فوم / PP / كريستال)';
      else if (n.includes('غطاء') || n.includes('شاليمو')) category = 'أغطية مسطحة وبارزة';
      else if (n.includes('سلطانية') || n.includes('شوربة')) category = 'سلطانيات وبولات طعام';
      else if (n.includes('علبة') || n.includes('مستطيل') || n.includes('مسدسة')) category = 'علب وجبات ومفصلية';
      else if (n.includes('بكر') || n.includes('رول') || n.includes('استرتش') || n.includes('شيت')) category = 'رولات وبكر استرتش وتغليف';
      else if (n.includes('قالب') || n.includes('ملعقة') || n.includes('شوكة') || n.includes('سكين')) category = 'قوالب وشوك وملاعق';
      else if (n.includes('كرتون')) category = 'صناديق كرتون مضلع';

      return {
        id: r.id,
        code: r.code,
        name: r.name,
        category: category,
        unit: r.unit_type === 'carton' ? 'كرتونة' : r.unit_type,
        itemsPerCarton: r.items_per_carton || 1
      };
    });

    // 1. Save JSON for the Bot AI to use
    const jsonPath = path.join(__dirname, 'data', 'catalog_packaging.json');
    fs.writeFileSync(jsonPath, JSON.stringify(categorized, null, 2), 'utf8');
    console.log(`Saved JSON catalog to: ${jsonPath}`);

    // 2. Export full Excel sheet
    const excelData = categorized.map((p, idx) => ({
      '#': idx + 1,
      'كود الصنف': p.code,
      'اسم المنتج': p.name,
      'القسم / التصنيف': p.category,
      'الوحدة': p.unit,
      'القطع بالكرتونة': p.itemsPerCarton
    }));

    const ws = xlsx.utils.json_to_sheet(excelData);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'منتجات التعبئة والتغليف');

    const excelPath = path.join(__dirname, 'قائمة_منتجات_التعبئة_والتغليف_والكرتون.xlsx');
    xlsx.writeFile(wb, excelPath);
    console.log(`Saved Excel sheet to: ${excelPath}`);

  } catch (err) {
    console.error('Export error:', err.message);
  } finally {
    await pool.end();
  }
}

exportCatalog();
