import re

with open('facts.md', encoding='utf-8') as f:
    lines = f.read().splitlines()

# 匹配 Markdown 格式控制符
skip = re.compile(r'^\s*(#{1,6}\s|>|[-*+]\s|\d+[.)]\s|```|\||-{3,}|={3,}|\t| {4})')

out = [l for l in lines if l.strip() and not skip.match(l)]

with open('facts.txt', 'w', encoding='utf-8') as f:
    f.write('\n'.join(out))
