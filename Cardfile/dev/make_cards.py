"""Generate synthetic business-card photos for testing the scanner.

Each card is rendered flat, then placed on a background with a slight
rotation, shadow, blur and noise so it looks like a phone photo.
Writes dev/cards/<id>.jpg and dev/cards/expected.json.
"""
import json
import os
import random

from PIL import Image, ImageDraw, ImageFilter, ImageFont

random.seed(7)
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "cards")
os.makedirs(OUT, exist_ok=True)

INTER = "/usr/share/fonts/opentype/inter/Inter-{}.otf"
SERIF = "/usr/share/fonts/truetype/dejavu/DejaVuSerif{}.ttf"
CARLITO = "/usr/share/fonts/truetype/crosextra/Carlito-{}.ttf"


def font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.truetype(INTER.format("Regular"), size)


W, H = 1050, 600

CARDS = [
    {
        "id": "furniture",
        "bg": (250, 247, 240), "fg": (40, 30, 25), "accent": (150, 40, 30),
        "lines": [
            ("Crimson Oak Furniture Co.", SERIF.format("-Bold"), 44, "accent", (70, 60)),
            ("Marcus Delgado", INTER.format("SemiBold"), 50, "fg", (70, 190)),
            ("Sales Manager", INTER.format("Regular"), 32, "fg", (70, 255)),
            ("T  205.555.0142", INTER.format("Regular"), 28, "fg", (70, 350)),
            ("C  (205) 555-0199", INTER.format("Regular"), 28, "fg", (70, 395)),
            ("marcus@crimsonoakfurniture.com", INTER.format("Regular"), 28, "fg", (70, 440)),
            ("www.crimsonoakfurniture.com", INTER.format("Regular"), 28, "fg", (70, 485)),
            ("1820 McFarland Blvd E, Tuscaloosa, AL 35404", INTER.format("Regular"), 24, "fg", (70, 535)),
        ],
        "expect": {
            "name": "Marcus Delgado", "title": "Sales Manager",
            "company": "Crimson Oak Furniture Co.",
            "phones": ["205-555-0142", "205-555-0199"],
            "emails": ["marcus@crimsonoakfurniture.com"],
            "website": "www.crimsonoakfurniture.com",
            "address_has": ["1820 McFarland", "35404"],
        },
    },
    {
        "id": "restaurant",
        "bg": (255, 255, 255), "fg": (20, 20, 20), "accent": (20, 20, 20),
        "lines": [
            ("THE IRON SKILLET", INTER.format("Black"), 64, "accent", (220, 50)),
            ("Southern Kitchen & Bar", SERIF.format("-Italic"), 30, "fg", (340, 135)),
            ("Jenna Whitfield", INTER.format("Medium"), 42, "fg", (330, 240)),
            ("General Manager", INTER.format("Light"), 30, "fg", (370, 295)),
            ("Phone: 205-555-0123", INTER.format("Regular"), 27, "fg", (80, 400)),
            ("Fax: 205-555-0124", INTER.format("Regular"), 27, "fg", (600, 400)),
            ("jenna.whitfield@ironskilletbar.com", INTER.format("Regular"), 27, "fg", (240, 450)),
            ("412 Greensboro Ave, Tuscaloosa AL 35401", INTER.format("Regular"), 25, "fg", (230, 520)),
        ],
        "expect": {
            "name": "Jenna Whitfield", "title": "General Manager",
            "company": "The Iron Skillet",
            "phones": ["205-555-0123"], "fax": "205-555-0124",
            "emails": ["jenna.whitfield@ironskilletbar.com"],
            "address_has": ["412 Greensboro", "35401"],
        },
    },
    {
        "id": "dentist",
        "bg": (236, 246, 250), "fg": (15, 50, 70), "accent": (0, 110, 140),
        "lines": [
            ("Riverside Family Dentistry", INTER.format("Bold"), 40, "accent", (70, 60)),
            ("Dr. Priya Raman, DDS", INTER.format("SemiBold"), 44, "fg", (70, 170)),
            ("Office (205) 555-0177", INTER.format("Regular"), 28, "fg", (70, 300)),
            ("Emergency +1 205 555 0188", INTER.format("Regular"), 28, "fg", (70, 345)),
            ("appointments@riversidesmiles.com", INTER.format("Regular"), 28, "fg", (70, 390)),
            ("riversidesmiles.com", INTER.format("Regular"), 28, "fg", (70, 435)),
            ("900 University Blvd, Suite 200", INTER.format("Regular"), 26, "fg", (70, 495)),
            ("Tuscaloosa, AL 35401", INTER.format("Regular"), 26, "fg", (70, 535)),
        ],
        "expect": {
            "name": "Priya Raman",
            "company": "Riverside Family Dentistry",
            "phones": ["205-555-0177", "205-555-0188"],
            "emails": ["appointments@riversidesmiles.com"],
            "website": "riversidesmiles.com",
            "address_has": ["900 University", "Suite 200", "35401"],
        },
    },
    {
        "id": "tech",
        "bg": (255, 255, 255), "fg": (30, 30, 35), "accent": (90, 60, 200),
        "lines": [
            ("KEVIN O'BRIEN", INTER.format("Bold"), 48, "fg", (70, 120)),
            ("Senior Software Engineer", INTER.format("Regular"), 30, "accent", (70, 185)),
            ("Northwind Systems, Inc.", INTER.format("Medium"), 30, "fg", (70, 240)),
            ("M: +1 (415) 555-2671", INTER.format("Regular"), 27, "fg", (70, 380)),
            ("kobrien@northwind.io", INTER.format("Regular"), 27, "fg", (70, 425)),
            ("northwind.io", INTER.format("Regular"), 27, "fg", (70, 470)),
        ],
        "expect": {
            "name": "Kevin O'Brien", "title": "Senior Software Engineer",
            "company": "Northwind Systems, Inc.",
            "phones": ["415-555-2671"],
            "emails": ["kobrien@northwind.io"], "website": "northwind.io",
        },
    },
    {
        "id": "realtor",
        "bg": (248, 248, 248), "fg": (50, 50, 50), "accent": (30, 80, 50),
        "lines": [
            ("Hartwell Realty Group", SERIF.format("-Bold"), 38, "accent", (70, 70)),
            ("Ana-Sofia Morales", SERIF.format(""), 46, "fg", (70, 230)),
            ("Realtor", INTER.format("Light"), 30, "fg", (70, 295)),
            ("555.867.5309 mobile", INTER.format("Regular"), 28, "fg", (70, 430)),
            ("ana@hartwellrealty.com", INTER.format("Regular"), 28, "fg", (70, 475)),
        ],
        "expect": {
            "name": "Ana-Sofia Morales", "title": "Realtor",
            "company": "Hartwell Realty Group",
            "phones": ["555-867-5309"], "emails": ["ana@hartwellrealty.com"],
        },
    },
    {
        "id": "dark",
        "bg": (28, 30, 38), "fg": (240, 240, 240), "accent": (255, 190, 80),
        "lines": [
            ("LUMEN STUDIO", INTER.format("ExtraBold"), 56, "accent", (70, 70)),
            ("Theo Park", INTER.format("SemiBold"), 44, "fg", (70, 250)),
            ("Creative Director", INTER.format("Light"), 30, "fg", (70, 310)),
            ("(312) 555-0110", INTER.format("Regular"), 28, "fg", (70, 420)),
            ("hello@lumen.studio", INTER.format("Regular"), 28, "fg", (70, 465)),
            ("lumen.studio", INTER.format("Regular"), 28, "fg", (70, 510)),
        ],
        "expect": {
            "name": "Theo Park", "title": "Creative Director",
            "company": "Lumen Studio",
            "phones": ["312-555-0110"], "emails": ["hello@lumen.studio"],
            "website": "lumen.studio",
        },
    },
]


def render_flat(card):
    img = Image.new("RGB", (W, H), card["bg"])
    d = ImageDraw.Draw(img)
    for text, fpath, size, color, pos in card["lines"]:
        d.text(pos, text, font=font(fpath, size), fill=card[color])
    # decorative rule, like many real cards
    d.rectangle((70, 135 if card["id"] != "tech" else 300, 300, 138 if card["id"] != "tech" else 303), fill=card["accent"])
    return img


def photograph(flat):
    """Place the card on a desk-like background like a phone photo."""
    PW, PH = 2000, 1500
    bg = Image.new("RGB", (PW, PH), (120, 105, 90))
    noise = Image.effect_noise((PW, PH), 18).convert("RGB")
    bg = Image.blend(bg, noise, 0.15)
    scale = random.uniform(1.45, 1.65)
    card = flat.resize((int(W * scale), int(H * scale)), Image.LANCZOS)
    angle = random.uniform(-3.5, 3.5)
    mask = Image.new("L", card.size, 255).rotate(angle, expand=True, resample=Image.BICUBIC)
    card = card.rotate(angle, expand=True, resample=Image.BICUBIC)
    x = (PW - card.width) // 2 + random.randint(-60, 60)
    y = (PH - card.height) // 2 + random.randint(-50, 50)
    shadow = Image.new("RGB", (PW, PH), (0, 0, 0))
    smask = Image.new("L", (PW, PH), 0)
    smask.paste(mask, (x + 18, y + 22))
    smask = smask.filter(ImageFilter.GaussianBlur(18)).point(lambda v: int(v * 0.45))
    bg = Image.composite(shadow, bg, smask)
    bg.paste(card, (x, y), mask)
    # uneven lighting
    grad = Image.linear_gradient("L").resize((PW, PH)).rotate(random.choice([0, 90, 180, 270]))
    bg = Image.composite(bg, Image.blend(bg, Image.new("RGB", (PW, PH), (0, 0, 0)), 0.25), grad)
    bg = bg.filter(ImageFilter.GaussianBlur(1.1))
    return bg


expected = {}
for c in CARDS:
    flat = render_flat(c)
    flat.save(os.path.join(OUT, f"{c['id']}_flat.png"))
    photograph(flat).save(os.path.join(OUT, f"{c['id']}.jpg"), quality=85)
    expected[c["id"]] = c["expect"]

with open(os.path.join(OUT, "expected.json"), "w") as f:
    json.dump(expected, f, indent=2)
print("wrote", len(CARDS), "cards to", OUT)
