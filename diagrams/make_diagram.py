#!/usr/bin/env python3
"""Generate JPG diagram of the app's data model (user-facing view)."""
from PIL import Image, ImageDraw, ImageFont
import os

# ---------- Canvas ----------
W, H = 2000, 1900
BG = (252, 252, 250)
img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)

# ---------- Fonts ----------
def load(size, bold=False):
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/Library/Fonts/Arial Unicode.ttf",
    ]
    for p in candidates:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return ImageFont.load_default()

F_TITLE = load(46, bold=True)
F_SECTION = load(30, bold=True)
F_BOX_TITLE = load(26, bold=True)
F_BOX_SUB = load(20, bold=True)
F_TEXT = load(20)
F_SMALL = load(17)
F_LABEL = load(18, bold=True)

# ---------- Colors ----------
C_SUPPLIER = (255, 236, 210)   # light orange
C_SUPPLIER_BORDER = (217, 119, 6)
C_RAW = (220, 240, 220)        # light green
C_RAW_BORDER = (34, 139, 34)
C_COMP = (220, 230, 255)       # light blue
C_COMP_BORDER = (37, 99, 235)
C_PRODUCT = (255, 224, 230)    # light pink
C_PRODUCT_BORDER = (190, 24, 93)
C_PLAN = (240, 220, 255)       # light purple
C_PLAN_BORDER = (124, 58, 237)
C_STOCK = (255, 245, 200)      # light yellow
C_STOCK_BORDER = (180, 140, 20)
C_REPORT = (255, 210, 210)     # light red
C_REPORT_BORDER = (200, 40, 40)
C_EMAIL = (210, 240, 240)      # light teal
C_EMAIL_BORDER = (15, 118, 110)
C_ARROW = (60, 60, 60)
C_TEXT = (30, 30, 30)
C_LABEL_BG = (255, 255, 255)

# ---------- Helpers ----------
def box(x, y, w, h, fill, border, title, subtitle, lines):
    d.rounded_rectangle([x, y, x + w, y + h], radius=14, fill=fill, outline=border, width=3)
    cy = y + 14
    d.text((x + w // 2, cy), title, font=F_BOX_TITLE, fill=C_TEXT, anchor="mt")
    cy += 36
    if subtitle:
        d.text((x + w // 2, cy), subtitle, font=F_BOX_SUB, fill=(90, 90, 90), anchor="mt")
        cy += 28
    # separator
    d.line([x + 18, cy + 4, x + w - 18, cy + 4], fill=border, width=1)
    cy += 14
    for ln in lines:
        d.text((x + 22, cy), ln, font=F_TEXT, fill=C_TEXT)
        cy += 26

def arrow(x1, y1, x2, y2, label=None, width=3, color=C_ARROW):
    d.line([x1, y1, x2, y2], fill=color, width=width)
    # arrowhead
    import math
    ang = math.atan2(y2 - y1, x2 - x1)
    ah = 16
    aw = 10
    bx = x2 - ah * math.cos(ang)
    by = y2 - ah * math.sin(ang)
    p1 = (bx + aw * math.cos(ang + math.pi / 2), by + aw * math.sin(ang + math.pi / 2))
    p2 = (bx - aw * math.cos(ang + math.pi / 2), by - aw * math.sin(ang + math.pi / 2))
    d.polygon([(x2, y2), p1, p2], fill=color)
    if label:
        mx, my = (x1 + x2) // 2, (y1 + y2) // 2
        tw = d.textlength(label, font=F_LABEL)
        pad = 6
        d.rectangle([mx - tw // 2 - pad, my - 14, mx + tw // 2 + pad, my + 14], fill=C_LABEL_BG, outline=color)
        d.text((mx, my), label, font=F_LABEL, fill=C_TEXT, anchor="mm")

def hline_arrow(x1, x2, y, label=None):
    arrow(x1, y, x2, y, label=label)

def vline_arrow(x, y1, y2, label=None):
    arrow(x, y1, x, y2, label=label)

# ---------- Title ----------
d.text((W // 2, 30), "Struktura danych aplikacji — widok użytkownika", font=F_TITLE, fill=C_TEXT, anchor="mt")
d.text((W // 2, 90), "Medykamenty · plany produkcji, produkty, surowce, dostawcy", font=F_SECTION, fill=(100, 100, 100), anchor="mt")

# ---------- SECTION 1: Catalog (top half) ----------
sec1_y = 160
d.text((60, sec1_y), "1. Katalog: dostawcy ↔ surowce / komponenty → produkt", font=F_SECTION, fill=(80, 80, 80))

# Layout: Supplier (left) — RawMaterial (top-center) / PackagingComponent (bottom-center) — Product (right)
# But for clarity: Supplier on left; RawMaterial top, Component bottom; Product right.

BOX_W = 420
BOX_H = 250

# Supplier (left, vertically centered)
sup_x, sup_y = 60, 320
box(sup_x, sup_y, BOX_W, BOX_H, C_SUPPLIER, C_SUPPLIER_BORDER,
    "DOSTAWCA", "(Supplier)",
    ["• nazwa firmy", "• e-mail, telefon", "• osoba kontaktowa", "• warunki płatności", "• preferowany język", "  korespondencji"])

# RawMaterial (center top)
raw_x, raw_y = 780, 220
box(raw_x, raw_y, BOX_W, BOX_H, C_RAW, C_RAW_BORDER,
    "SUROWIEC", "(RawMaterial)",
    ["• nazwa, symbol MP", "• jednostka (g/kg/ml/l)", "• MOQ, lead time", "• cena ostatniego zakupu", "• dostarcza fabryka?",
     "• lista dostawców + preferowany"])

# PackagingComponent (center bottom)
cmp_x, cmp_y = 780, 530
box(cmp_x, cmp_y, BOX_W, BOX_H, C_COMP, C_COMP_BORDER,
    "KOMPONENT OPAKOWANIOWY", "(PackagingComponent)",
    ["• typ: tuba / butelka / etykieta", "  / pompka / karton / saszetka", "• symbol MP, MOQ, cena",
     "• lista dostawców + preferowany"])

# Product (right, vertically centered between Raw and Component)
prod_x, prod_y = 1500, 360
PROD_H = 380
d.rounded_rectangle([prod_x, prod_y, prod_x + BOX_W, prod_y + PROD_H], radius=14,
                    fill=C_PRODUCT, outline=C_PRODUCT_BORDER, width=3)
cy = prod_y + 14
d.text((prod_x + BOX_W // 2, cy), "PRODUKT", font=F_BOX_TITLE, fill=C_TEXT, anchor="mt"); cy += 36
d.text((prod_x + BOX_W // 2, cy), "(Product)", font=F_BOX_SUB, fill=(90, 90, 90), anchor="mt"); cy += 28
d.line([prod_x + 18, cy + 4, prod_x + BOX_W - 18, cy + 4], fill=C_PRODUCT_BORDER, width=1); cy += 14
for ln in ["• nazwa, SKU",
           "• pojemność (ml), gęstość (g/ml)",
           "• MOQ w sztukach",
           "• koszt konfekcji",
           "• masa na saszetki + ich liczba",
           "",
           "RECEPTURA:",
           "  ▸ składniki: surowiec + %",
           "  ▸ opakowania: komponent + qty"]:
    d.text((prod_x + 22, cy), ln, font=F_TEXT, fill=C_TEXT); cy += 26

# Arrows in section 1
# Supplier -> RawMaterial (N:M)
arrow(sup_x + BOX_W, sup_y + 80, raw_x, raw_y + 80, label="N : M  dostarcza")
# Supplier -> Component (N:M)
arrow(sup_x + BOX_W, sup_y + 180, cmp_x, cmp_y + 80, label="N : M  dostarcza")
# RawMaterial -> Product (used in recipe)
arrow(raw_x + BOX_W, raw_y + 125, prod_x, prod_y + 140, label="używany jako składnik")
# Component -> Product
arrow(cmp_x + BOX_W, cmp_y + 125, prod_x, prod_y + 240, label="używany jako opakowanie")

# ---------- Divider ----------
div_y = 870
d.line([60, div_y, W - 60, div_y], fill=(200, 200, 200), width=2)

# ---------- SECTION 2: Production flow ----------
d.text((60, div_y + 20), "2. Przepływ produkcyjny: plan → magazyn → braki → e-maile do dostawców",
       font=F_SECTION, fill=(80, 80, 80))

flow_y = div_y + 90

# Layout for section 2:
#   Column A (left):  PLAN (top)    STOCK (bottom)
#   Column B (right): REPORT (top)  EMAIL  (bottom)
# Two converging arrows: Plan->Report (top), Stock->Report (diagonal up-right)
# Then Report->Email (vertical down)

# Plan (top-left)
plan_x, plan_y = 100, flow_y
PLAN_H = 280
d.rounded_rectangle([plan_x, plan_y, plan_x + BOX_W, plan_y + PLAN_H], radius=14,
                    fill=C_PLAN, outline=C_PLAN_BORDER, width=3)
cy = plan_y + 14
d.text((plan_x + BOX_W // 2, cy), "PLAN PRODUKCJI", font=F_BOX_TITLE, fill=C_TEXT, anchor="mt"); cy += 36
d.text((plan_x + BOX_W // 2, cy), "(ProductionPlan)", font=F_BOX_SUB, fill=(90, 90, 90), anchor="mt"); cy += 28
d.line([plan_x + 18, cy + 4, plan_x + BOX_W - 18, cy + 4], fill=C_PLAN_BORDER, width=1); cy += 14
for ln in ["• nazwa, status",
           "• items: produkt + ilość szt.",
           "• bulkMass: produkt + kg luzem",
           "• actualProduced (po realizacji)"]:
    d.text((plan_x + 22, cy), ln, font=F_TEXT, fill=C_TEXT); cy += 28

# Stock (bottom-left)
stock_x, stock_y = 100, plan_y + PLAN_H + 80
STOCK_H = 260
d.rounded_rectangle([stock_x, stock_y, stock_x + BOX_W, stock_y + STOCK_H], radius=14,
                    fill=C_STOCK, outline=C_STOCK_BORDER, width=3)
cy = stock_y + 14
d.text((stock_x + BOX_W // 2, cy), "STAN MAGAZYNOWY", font=F_BOX_TITLE, fill=C_TEXT, anchor="mt"); cy += 36
d.text((stock_x + BOX_W // 2, cy), "(StockSnapshot)", font=F_BOX_SUB, fill=(90, 90, 90), anchor="mt"); cy += 28
d.line([stock_x + 18, cy + 4, stock_x + BOX_W - 18, cy + 4], fill=C_STOCK_BORDER, width=1); cy += 14
for ln in ["• data importu, plik źródłowy",
           "• rodzaj: surowce / komponenty",
           "• pozycje dopasowane do",
           "  surowca lub komponentu",
           "  (po nazwie / symbolu MP)"]:
    d.text((stock_x + 22, cy), ln, font=F_TEXT, fill=C_TEXT); cy += 26

# Report (top-right)
rep_x, rep_y = 1100, flow_y
REP_H = 280
REP_W = 520
d.rounded_rectangle([rep_x, rep_y, rep_x + REP_W, rep_y + REP_H], radius=14,
                    fill=C_REPORT, outline=C_REPORT_BORDER, width=3)
cy = rep_y + 14
d.text((rep_x + REP_W // 2, cy), "RAPORT BRAKÓW", font=F_BOX_TITLE, fill=C_TEXT, anchor="mt"); cy += 36
d.text((rep_x + REP_W // 2, cy), "(ShortageReport)", font=F_BOX_SUB, fill=(90, 90, 90), anchor="mt"); cy += 28
d.line([rep_x + 18, cy + 4, rep_x + REP_W - 18, cy + 4], fill=C_REPORT_BORDER, width=1); cy += 14
for ln in ["• wymagane vs dostępne",
           "• brakujące surowce / komponenty",
           "• sugerowana ilość zamówienia",
           "  (z uwzględnieniem MOQ)",
           "• pogrupowane wg DOSTAWCY"]:
    d.text((rep_x + 22, cy), ln, font=F_TEXT, fill=C_TEXT); cy += 28

# Email (bottom-right)
em_x, em_y = 1100, plan_y + PLAN_H + 80
EM_H = 260
EM_W = 520
d.rounded_rectangle([em_x, em_y, em_x + EM_W, em_y + EM_H], radius=14,
                    fill=C_EMAIL, outline=C_EMAIL_BORDER, width=3)
cy = em_y + 14
d.text((em_x + EM_W // 2, cy), "PACZKA E-MAILI RFQ", font=F_BOX_TITLE, fill=C_TEXT, anchor="mt"); cy += 36
d.text((em_x + EM_W // 2, cy), "(EmailBatch)", font=F_BOX_SUB, fill=(90, 90, 90), anchor="mt"); cy += 28
d.line([em_x + 18, cy + 4, em_x + EM_W - 18, cy + 4], fill=C_EMAIL_BORDER, width=1); cy += 14
for ln in ["• osobny e-mail do każdego",
           "  dostawcy w jego języku (PL/EN)",
           "• lista braków do wyceny",
           "  / zamówienia",
           "• opcjonalna korekta treści AI"]:
    d.text((em_x + 22, cy), ln, font=F_TEXT, fill=C_TEXT); cy += 28

# Arrows section 2
# Plan -> Report (top horizontal)
arrow(plan_x + BOX_W, plan_y + PLAN_H // 2, rep_x, rep_y + PLAN_H // 2,
      label="oblicz braki")
# Stock -> Report (diagonal up-right)
arrow(stock_x + BOX_W, stock_y + 60, rep_x, rep_y + REP_H - 40,
      label="zasila danymi")
# Report -> Email (vertical down)
arrow(rep_x + REP_W // 2, rep_y + REP_H, em_x + EM_W // 2, em_y,
      label="generuj e-maile")

# Footer legend
leg_y = H - 70
d.text((60, leg_y), "Legenda:  ─►  „używa / zasila",
       font=F_TEXT, fill=(80, 80, 80))
d.text((60, leg_y + 30),
       "N : M  oznacza relację wiele-do-wielu (np. ten sam surowiec może mieć kilku dostawców, a dostawca dostarcza wiele surowców).",
       font=F_TEXT, fill=(80, 80, 80))

# Save
out_jpg = "/Users/wmankowski/medykamenty/diagrams/struktura_danych.jpg"
img.save(out_jpg, "JPEG", quality=92)
print("Saved:", out_jpg, img.size)
