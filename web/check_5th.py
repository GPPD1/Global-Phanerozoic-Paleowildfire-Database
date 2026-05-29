import re

raw = open('plates/pleopoint.gpml', 'r', encoding='UTF-8').read()
blocks = re.findall(r'<gml:featureMember>(.*?)</gml:featureMember>', raw, re.DOTALL)
print(f"Total blocks: {len(blocks)}")

# Check the 5th block (index 4)
b5 = blocks[4]
nm = re.search(r'<gml:name>([^<]+)</gml:name>', b5)
bm = re.search(r'<gml:begin>.*?gml:timePosition[^>]*>([\d.]+)', b5, re.DOTALL)
em = re.search(r'<gml:end>.*?gml:timePosition[^>]*>([\d.]+)', b5, re.DOTALL)
print(f"\n5th featureMember (index 4):")
print(f"  gml:name = {nm.group(1) if nm else 'NOT FOUND'}")
print(f"  tBegin = {bm.group(1) if bm else 'NOT FOUND'}")
print(f"  tEnd = {em.group(1) if em else 'NOT FOUND'}")

# Also find the block with gml:name=5
for i, blk in enumerate(blocks):
    n = re.search(r'<gml:name>([^<]+)</gml:name>', blk)
    if n and n.group(1).strip() == '5':
        bm2 = re.search(r'<gml:begin>.*?gml:timePosition[^>]*>([\d.]+)', blk, re.DOTALL)
        em2 = re.search(r'<gml:end>.*?gml:timePosition[^>]*>([\d.]+)', blk, re.DOTALL)
        print(f"\nBlock with gml:name=5 is at index {i}:")
        print(f"  tBegin = {bm2.group(1) if bm2 else 'NOT FOUND'}")
        print(f"  tEnd = {em2.group(1) if em2 else 'NOT FOUND'}")
        break

# Now check badly_fixed.gpml 5th block
raw2 = open('plates/badly_fixed.gpml', 'r', encoding='UTF-8').read()
blocks2 = re.findall(r'<gml:featureMember>(.*?)</gml:featureMember>', raw2, re.DOTALL)
b5_bf = blocks2[4]
nm_bf = re.search(r'<gml:name>([^<]+)</gml:name>', b5_bf)
bm_bf = re.search(r'<gml:begin>.*?gml:timePosition[^>]*>([\d.]+)', b5_bf, re.DOTALL)
em_bf = re.search(r'<gml:end>.*?gml:timePosition[^>]*>([\d.]+)', b5_bf, re.DOTALL)
print(f"\n5th featureMember in badly_fixed.gpml:")
print(f"  gml:name = {nm_bf.group(1) if nm_bf else 'NOT FOUND'}")
print(f"  tBegin = {bm_bf.group(1) if bm_bf else 'NOT FOUND'}")
print(f"  tEnd = {em_bf.group(1) if em_bf else 'NOT FOUND'}")

# Also check paleo_data.json for id=5
import json
paleo = json.load(open('paleo_data.json', 'r', encoding='utf-8'))
for cat_key, cat_val in paleo.items():
    if not isinstance(cat_val, dict) or 'data' not in cat_val:
        continue
    for item in cat_val['data']:
        if item['id'] == 5:
            print(f"\npaleo_data.json id=5:")
            print(f"  lat={item['lat']}")
            print(f"  lng={item['lng']}")
            print(f"  category={cat_key}")
            break