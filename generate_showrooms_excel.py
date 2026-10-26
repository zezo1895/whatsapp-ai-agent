# -*- coding: utf-8 -*-
import json
import os
import shutil
import sys
import openpyxl

if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

def build_showrooms_excel():
    # 1. Load branches data
    json_path = os.path.join(os.path.dirname(__file__), 'data', 'knowledge.json')
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    branches = data.get('branches', [])
    print(f"Loaded {len(branches)} branches from knowledge.json")

    wb = openpyxl.Workbook()
    
    # -------------------------------------------------------------
    # Styling Palette (Corporate Navy & Gold)
    # -------------------------------------------------------------
    font_family = "Segoe UI"
    
    title_font = Font(name=font_family, size=16, bold=True, color="FFFFFF")
    subtitle_font = Font(name=font_family, size=11, bold=False, color="E2E8F0")
    header_font = Font(name=font_family, size=11, bold=True, color="FFFFFF")
    data_font = Font(name=font_family, size=10, color="1E293B")
    data_font_bold = Font(name=font_family, size=10, bold=True, color="0F172A")
    link_font = Font(name=font_family, size=10, color="1D4ED8", underline="single", bold=True)
    kpi_title_font = Font(name=font_family, size=9, bold=True, color="475569")
    kpi_value_font = Font(name=font_family, size=14, bold=True, color="1E3A8A")

    title_fill = PatternFill(start_color="1E3A8A", end_color="1E3A8A", fill_type="solid") # Dark Navy Blue
    header_fill = PatternFill(start_color="2563EB", end_color="2563EB", fill_type="solid") # Royal Blue
    even_row_fill = PatternFill(start_color="FFFFFF", end_color="FFFFFF", fill_type="solid")
    odd_row_fill = PatternFill(start_color="F8FAFC", end_color="F8FAFC", fill_type="solid") # Slate light
    kpi_fill = PatternFill(start_color="EFF6FF", end_color="EFF6FF", fill_type="solid") # Light Blue
    accent_fill = PatternFill(start_color="FEF3C7", end_color="FEF3C7", fill_type="solid") # Warm Amber

    thin_border_side = Side(border_style="thin", color="CBD5E1")
    cell_border = Border(left=thin_border_side, right=thin_border_side, top=thin_border_side, bottom=thin_border_side)
    thick_bottom = Border(left=thin_border_side, right=thin_border_side, top=thin_border_side, bottom=Side(border_style="medium", color="1E3A8A"))

    align_center = Alignment(horizontal="center", vertical="center", wrap_text=True)
    align_right = Alignment(horizontal="right", vertical="center", wrap_text=True)
    align_left = Alignment(horizontal="left", vertical="center", wrap_text=True)

    # -------------------------------------------------------------
    # SHEET 1: دليل الفروع والمعارض
    # -------------------------------------------------------------
    ws1 = wb.active
    ws1.title = "دليل المعارض والفروع"
    ws1.sheet_view.rightToLeft = True
    ws1.views.sheetView[0].showGridLines = True

    # Title Banner (Rows 1 & 2)
    ws1.merge_cells("A1:J1")
    ws1["A1"] = "حكيم جروب | دليل المعارض والفروع والمراكز الرئيسية (قطاع التعبئة والتغليف والألومنيوم)"
    ws1["A1"].font = title_font
    ws1["A1"].fill = title_fill
    ws1["A1"].alignment = align_center
    ws1.row_dimensions[1].height = 35

    ws1.merge_cells("A2:J2")
    ws1["A2"] = "جميع المعارض مجهزة بعينات المنتجات وكتالوجات المقاسات - مواعيد العمل: يومياً 9:00 ص إلى 6:00 م - هاتف الإدارة والمبيعات الموحد: 01144505575"
    ws1["A2"].font = subtitle_font
    ws1["A2"].fill = PatternFill(start_color="1E40AF", end_color="1E40AF", fill_type="solid")
    ws1["A2"].alignment = align_center
    ws1.row_dimensions[2].height = 24

    # KPI Summary Cards (Row 4)
    # Card 1: Total Showrooms
    ws1.merge_cells("A4:B4")
    ws1["A4"] = f"إجمالي المعارض والمقرات\n{len(branches)} فرع ومعرض"
    ws1["A4"].font = Font(name=font_family, size=11, bold=True, color="1E3A8A")
    ws1["A4"].fill = kpi_fill
    ws1["A4"].alignment = align_center
    ws1["A4"].border = cell_border
    ws1["B4"].border = cell_border

    # Card 2: Governorates Covered
    governorates = list(set(b.get('governorate', '').replace('القاهره', 'القاهرة').replace('الجيزه', 'الجيزة').replace('الاسكندريه', 'الإسكندرية').strip() for b in branches if b.get('governorate')))
    ws1.merge_cells("C4:D4")
    ws1["C4"] = f"المحافظات المغطاة\n{len(governorates)} محافظة على مستوى الجمهورية"
    ws1["C4"].font = Font(name=font_family, size=11, bold=True, color="1E3A8A")
    ws1["C4"].fill = kpi_fill
    ws1["C4"].alignment = align_center
    ws1["C4"].border = cell_border
    ws1["D4"].border = cell_border

    # Card 3: Online Catalog
    ws1.merge_cells("E4:G4")
    ws1["E4"] = "الكتالوج والموقع الرسمي للأصناف والمقاسات\nhakim-chi.vercel.app/products"
    ws1["E4"].font = Font(name=font_family, size=10, bold=True, color="047857")
    ws1["E4"].fill = PatternFill(start_color="ECFDF5", end_color="ECFDF5", fill_type="solid")
    ws1["E4"].alignment = align_center
    ws1["E4"].border = cell_border
    ws1["F4"].border = cell_border
    ws1["G4"].border = cell_border

    # Card 4: Main Factory
    ws1.merge_cells("H4:J4")
    ws1["H4"] = "صرح المصانع الرئيسي والمقر العام\nمدينة العاشر من رمضان - المنطقة الصناعية الثالثة B4"
    ws1["H4"].font = Font(name=font_family, size=10, bold=True, color="B45309")
    ws1["H4"].fill = PatternFill(start_color="FFFBEB", end_color="FFFBEB", fill_type="solid")
    ws1["H4"].alignment = align_center
    ws1["H4"].border = cell_border
    ws1["I4"].border = cell_border
    ws1["J4"].border = cell_border

    ws1.row_dimensions[4].height = 42

    # Table Headers (Row 6)
    headers = [
        ("م", 6, align_center),
        ("اسم المعرض / الفرع", 28, align_right),
        ("المحافظة", 16, align_center),
        ("المدينة / المنطقة", 18, align_center),
        ("العنوان التفصيلي", 45, align_right),
        ("رقم الهاتف للتواصل", 18, align_center),
        ("لوكيشن خرائط جوجل", 22, align_center),
        ("المناطق المخدومة", 35, align_right),
        ("نوع المقر / الملاحظات", 30, align_right),
        ("مواعيد العمل", 20, align_center)
    ]

    header_row = 6
    ws1.row_dimensions[header_row].height = 30
    for col_idx, (h_title, col_width, h_align) in enumerate(headers, start=1):
        cell = ws1.cell(row=header_row, column=col_idx, value=h_title)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = align_center
        cell.border = thick_bottom

    # Populate Data Rows
    current_row = 7
    for idx, b in enumerate(branches, start=1):
        ws1.row_dimensions[current_row].height = 32
        row_fill = odd_row_fill if idx % 2 == 1 else even_row_fill

        name = b.get('name', '').strip()
        # Fix typo if any
        if 'المصنورة' in name:
            name = name.replace('المصنورة', 'المنصورة')

        gov = b.get('governorate', '').strip()
        gov = gov.replace('القاهره', 'القاهرة').replace('الجيزه', 'الجيزة').replace('الاسكندريه', 'الإسكندرية')

        city = b.get('city', '').strip()
        if 'المصنورة' in city:
            city = city.replace('المصنورة', 'المنصورة')

        addr = b.get('address', '').strip()
        phone = b.get('phone', '').strip()
        map_link = b.get('mapLink', '').strip()
        served = b.get('servedAreas', '').strip()
        notes = b.get('notes', '').strip()
        
        # Determine note if empty
        if not notes:
            if idx == 1 or "المصانع" in name:
                notes = "المقر الرئيسي والمجمع الصناعي لخطوط الإنتاج والتوزيع"
            elif "سموحه" in name or "مدينة نصر" in name or "فيصل" in name:
                notes = "معرض رئيسي متكامل (عينات تعبئة وتغليف وقطاعات ألومنيوم)"
            else:
                notes = "معرض ومبيعات رسمية - عينات واستلام طلبيات"

        working_hours = "يومياً 9:00 ص - 6:00 م"

        row_data = [
            (idx, align_center, data_font_bold, None),
            (name, align_right, data_font_bold, None),
            (gov, align_center, data_font, None),
            (city, align_center, data_font, None),
            (addr, align_right, data_font, None),
            (phone, align_center, data_font_bold, None),
            ("فتح لوكيشن الخريطة 📍" if map_link else "غير متوفر", align_center, link_font if map_link else data_font, map_link if map_link else None),
            (served, align_right, data_font, None),
            (notes, align_right, data_font, None),
            (working_hours, align_center, data_font, None)
        ]

        for col_idx, (val, c_align, c_font, hyperlink_url) in enumerate(row_data, start=1):
            cell = ws1.cell(row=current_row, column=col_idx, value=val)
            cell.font = c_font
            cell.alignment = c_align
            cell.fill = row_fill
            cell.border = cell_border
            if hyperlink_url:
                cell.hyperlink = hyperlink_url

        current_row += 1

    # Set column widths
    for col_idx, (_, col_width, _) in enumerate(headers, start=1):
        col_letter = get_column_letter(col_idx)
        ws1.column_dimensions[col_letter].width = col_width

    # -------------------------------------------------------------
    # SHEET 2: توزيع الفروع حسب المحافظات
    # -------------------------------------------------------------
    ws2 = wb.create_sheet(title="توزيع الفروع حسب المحافظات")
    ws2.sheet_view.rightToLeft = True
    ws2.views.sheetView[0].showGridLines = True

    # Title Banner Sheet 2
    ws2.merge_cells("A1:E1")
    ws2["A1"] = "حكيم جروب | توزيع شبكة الفروع والمعارض حسب المحافظات"
    ws2["A1"].font = title_font
    ws2["A1"].fill = title_fill
    ws2["A1"].alignment = align_center
    ws2.row_dimensions[1].height = 35

    # Group branches by governorate
    gov_groups = {}
    for b in branches:
        g = b.get('governorate', '').strip()
        g = g.replace('القاهره', 'القاهرة').replace('الجيزه', 'الجيزة').replace('الاسكندريه', 'الإسكندرية')
        if not g:
            g = "أخرى"
        if g not in gov_groups:
            gov_groups[g] = []
        gov_groups[g].append(b)

    # Sort governorates by number of branches descending
    sorted_govs = sorted(gov_groups.items(), key=lambda x: len(x[1]), reverse=True)

    headers_s2 = [
        ("م", 6),
        ("المحافظة", 20),
        ("عدد المعارض والفروع", 22),
        ("أسماء المعارض والمقرات في المحافظة", 45),
        ("أرقام تليفونات المعارض", 35)
    ]

    ws2.row_dimensions[3].height = 28
    for col_idx, (h_title, col_width) in enumerate(headers_s2, start=1):
        cell = ws2.cell(row=3, column=col_idx, value=h_title)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = align_center
        cell.border = thick_bottom
        ws2.column_dimensions[get_column_letter(col_idx)].width = col_width

    row_s2 = 4
    for idx, (gov_name, g_branches) in enumerate(sorted_govs, start=1):
        ws2.row_dimensions[row_s2].height = 30
        row_fill = odd_row_fill if idx % 2 == 1 else even_row_fill

        b_names = " ، ".join([b.get('name', '').replace('المصنورة', 'المنصورة') for b in g_branches])
        b_phones = " | ".join([b.get('phone', '') for b in g_branches if b.get('phone')])

        s2_cells = [
            (idx, align_center, data_font_bold),
            (gov_name, align_center, data_font_bold),
            (f"{len(g_branches)} معرض / فرع", align_center, data_font_bold),
            (b_names, align_right, data_font),
            (b_phones, align_center, data_font)
        ]

        for col_idx, (val, c_align, c_font) in enumerate(s2_cells, start=1):
            cell = ws2.cell(row=row_s2, column=col_idx, value=val)
            cell.font = c_font
            cell.alignment = c_align
            cell.fill = row_fill
            cell.border = cell_border

        row_s2 += 1

    # Total row in sheet 2
    ws2.row_dimensions[row_s2].height = 30
    total_cell_label = ws2.cell(row=row_s2, column=2, value="الإجمالي العام")
    total_cell_label.font = Font(name=font_family, size=11, bold=True, color="1E3A8A")
    total_cell_label.alignment = align_center
    total_cell_label.fill = accent_fill
    total_cell_label.border = cell_border

    total_cell_val = ws2.cell(row=row_s2, column=3, value=f"{len(branches)} فرع ومعرض")
    total_cell_val.font = Font(name=font_family, size=11, bold=True, color="1E3A8A")
    total_cell_val.alignment = align_center
    total_cell_val.fill = accent_fill
    total_cell_val.border = cell_border

    # -------------------------------------------------------------
    # SHEET 3: معلومات التواصل والكتالوج
    # -------------------------------------------------------------
    ws3 = wb.create_sheet(title="معلومات التواصل والموقع الرسمي")
    ws3.sheet_view.rightToLeft = True
    ws3.views.sheetView[0].showGridLines = True

    ws3.merge_cells("A1:D1")
    ws3["A1"] = "حكيم جروب | القنوات الرسمية وخدمة العملاء والكتالوج الإلكتروني"
    ws3["A1"].font = title_font
    ws3["A1"].fill = title_fill
    ws3["A1"].alignment = align_center
    ws3.row_dimensions[1].height = 35

    info_data = [
        ("اسم المؤسسة", "حكيم جروب (Hakim Group) - صرح صناعي متكامل للتعبئة والتغليف والألومنيوم"),
        ("المقر والمصانع الرئيسية", "مدينة العاشر من رمضان - المنطقة الصناعية الثالثة B4"),
        ("الهاتف الموحد للمبيعات والإدارة", "01144505575"),
        ("رابط لوكيشن المصانع والمقر الرئيسي", "https://maps.app.goo.gl/oPo8iH7z8xPM3ZW16?g_st=ac"),
        ("الموقع الرسمي وتصفح الكتالوج أونلاين", "https://hakim-chi.vercel.app/products"),
        ("أقسام المنتجات المتاحة بالمعارض", "أكواب ورقية وبلاستيك، سلطانيات محكمة، أطباق فوم، علب كرافت ووجبات، علب ميكروويف، رولات استرتش، قطاعات ألومنيوم"),
        ("مواعيد العمل الرسمية بالمعارض", "يومياً من الساعة 9:00 صباحاً حتى الساعة 6:00 مساءً (ما عدا الجمعة عطلة أسبوعية)"),
        ("سياسة المعاينة والاستلام", "يمكن للعميل زيارة أقرب معرض لمعاينة المقاسات والخامات والتسوق الفوري أو التنسيق لطلبيات الجملة")
    ]

    ws3.column_dimensions["A"].width = 35
    ws3.column_dimensions["B"].width = 75

    ws3.row_dimensions[3].height = 25
    c1 = ws3.cell(row=3, column=1, value="البيان / القناة")
    c1.font = header_font
    c1.fill = header_fill
    c1.alignment = align_center
    c1.border = cell_border

    c2 = ws3.cell(row=3, column=2, value="التفاصيل والرابط")
    c2.font = header_font
    c2.fill = header_fill
    c2.alignment = align_center
    c2.border = cell_border

    for idx, (label, val) in enumerate(info_data, start=4):
        ws3.row_dimensions[idx].height = 28
        r_fill = odd_row_fill if idx % 2 == 1 else even_row_fill

        cell_lbl = ws3.cell(row=idx, column=1, value=label)
        cell_lbl.font = data_font_bold
        cell_lbl.alignment = align_right
        cell_lbl.fill = r_fill
        cell_lbl.border = cell_border

        cell_val = ws3.cell(row=idx, column=2, value=val)
        cell_val.alignment = align_right
        cell_val.fill = r_fill
        cell_val.border = cell_border

        if val.startswith("http"):
            cell_val.font = link_font
            cell_val.hyperlink = val
        else:
            cell_val.font = data_font

    # -------------------------------------------------------------
    # Output file paths
    # -------------------------------------------------------------
    output_filename = "دليل_معارض_وفروع_حكيم_جروب.xlsx"
    ascii_filename = "hakim_group_branches.xlsx"

    target_paths = [
        os.path.join(os.path.dirname(__file__), output_filename),
        os.path.join(os.path.dirname(__file__), "public", output_filename),
        os.path.join(os.path.dirname(__file__), "public", ascii_filename),
        os.path.join(r"C:\Users\Desgin\.gemini\antigravity\brain\5b47138b-fbdd-4afd-b509-a645a615ab0f", output_filename)
    ]

    # Save to the first path
    primary_path = target_paths[0]
    wb.save(primary_path)
    print(f"Workbook successfully saved to: {primary_path}")

    # Copy to remaining targets
    for p in target_paths[1:]:
        try:
            os.makedirs(os.path.dirname(p), exist_ok=True)
            shutil.copy2(primary_path, p)
            print(f"Copied to: {p}")
        except Exception as e:
            print(f"Warning: could not copy to {p}: {e}")

if __name__ == "__main__":
    build_showrooms_excel()
