from PIL import Image, ImageDraw, ImageFont
import os

# Canvas size
W, H = 1280, 720

# Colors
bg = "#1e1e1e"
title_bar = "#2d2d2d"
red = "#ff5f56"
yellow = "#ffbd2e"
green = "#27c93f"
text = "#e6e6e6"
prompt = "#7ee787"
accent = "#82aaff"
comment = "#7f848e"
selection = "#3d3d3d"

img = Image.new("RGB", (W, H), bg)
draw = ImageDraw.Draw(img)

# Title bar
r = 8
draw.rounded_rectangle([0, 0, W, 36], radius=r, fill=title_bar)

# Buttons
draw.ellipse([16, 12, 26, 22], fill=red)
draw.ellipse([36, 12, 46, 22], fill=yellow)
draw.ellipse([56, 12, 66, 22], fill=green)

# Title text
try:
    font_title = ImageFont.truetype("Consolas", 14)
except:
    font_title = ImageFont.load_default()

draw.text((W//2, 10), "latte", fill=text, font=font_title, anchor="mt")

# Load fonts: mono for ASCII, CJK font for Chinese
def load_font(size=16):
    candidates = [
        r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\msyhbd.ttc",
        r"C:\Windows\Fonts\simhei.ttf",
        r"C:\Windows\Fonts\simsun.ttc",
        r"C:\Windows\Fonts\simsunb.ttf",
        "/System/Library/Fonts/PingFang.ttc",
        "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
        "Consolas",
        "DejaVuSansMono.ttf",
    ]
    for c in candidates:
        try:
            return ImageFont.truetype(c, size)
        except:
            continue
    return ImageFont.load_default()

font = load_font(16)
font_sm = load_font(14)

line_height = 26

def textline(x, y, content, color=text, fnt=font):
    draw.text((x, y), content, fill=color, font=fnt)

# Terminal content area
margin = 24
y = 36 + margin

# Welcome / version
textline(margin, y, "latte v2.1.90", color=accent)
y += line_height
textline(margin, y, "Type /help for available commands", color=comment, fnt=font_sm)
y += int(line_height * 1.5)

# User prompt
textline(margin, y, ">>> 帮我写一个 hello.py，内容是打印 'Hello, Latte'", color=prompt)
y += int(line_height * 1.5)

# Assistant response
textline(margin, y, "好的，我来帮你创建这个文件。", color=text)
y += line_height

# Tool use block
box_y = y
box_h = 84
draw.rounded_rectangle([margin, box_y, W - margin, box_y + box_h], radius=6, fill=selection, outline="#444")

textline(margin + 12, box_y + 10, "Bash", color=accent)
textline(margin + 12, box_y + 36, "cat > hello.py << 'EOF'", color=text)
textline(margin + 12, box_y + 62, "print('Hello, Latte')", color=text)

y += box_h + line_height

# Result block
draw.rounded_rectangle([margin, y, W - margin, y + 34], radius=6, fill=selection, outline="#444")
textline(margin + 12, y + 8, "FileWrite: hello.py", color=accent)
y += 34 + line_height

# Final assistant message
textline(margin, y, "已创建 hello.py，你可以直接运行：", color=text)
y += line_height
textline(margin + 24, y, "python hello.py", color=comment)
y += int(line_height * 1.5)

# User follow-up
textline(margin, y, ">>> 运行一下", color=prompt)
y += int(line_height * 1.5)

# Another tool block
box_y = y
box_h = 60
draw.rounded_rectangle([margin, box_y, W - margin, box_y + box_h], radius=6, fill=selection, outline="#444")
textline(margin + 12, box_y + 10, "Bash", color=accent)
textline(margin + 12, box_y + 36, "python hello.py", color=text)
y += box_h + line_height

# Output
draw.rounded_rectangle([margin, y, W - margin, y + 34], radius=6, fill="#252525")
textline(margin + 12, y + 8, "Hello, Latte", color=text)
y += 34 + line_height

# Bottom prompt
textline(margin, y, ">>> ", color=prompt)
# Cursor
draw.rectangle([margin + 48, y + 2, margin + 50, y + 20], fill=prompt)

# Save
img.save("assets/screenshot.png")
print("Generated assets/screenshot.png")
