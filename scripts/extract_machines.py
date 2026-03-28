
import json
import os

INPUT_FILE = os.path.abspath(os.path.join(os.path.dirname(__file__), '../machines/Esprit Machine Library.txt'))
OUTPUT_JSON = os.path.abspath(os.path.join(os.path.dirname(__file__), '../machines/manufacturers.json'))
MACHINES_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '../machines/'))

def parse_manufacturers_models(lines):
    manufacturers = {}
    current_manufacturer = None
    for line in lines:
        line = line.strip()
        if not line or line == 'Machines':
            continue
        if line.isupper() and len(line) > 2:
            current_manufacturer = line
            manufacturers[current_manufacturer] = []
        elif current_manufacturer:
            if line and not line.isupper():
                manufacturers[current_manufacturer].append(line)
    return manufacturers

def safe_filename(name):
    return ''.join(c if c.isalnum() or c in (' ', '-', '_') else '_' for c in name).replace(' ', '_')

def create_dirs_and_files(manufacturers):
    for manu, models in manufacturers.items():
        manu_dir = os.path.join(MACHINES_DIR, safe_filename(manu))
        os.makedirs(manu_dir, exist_ok=True)
        for model in models:
            model_file = os.path.join(manu_dir, f"{safe_filename(model)}.json")
            if not os.path.exists(model_file):
                with open(model_file, 'w', encoding='utf-8') as f:
                    json.dump({"manufacturer": manu, "model": model}, f, indent=2)

def main():
    with open(INPUT_FILE, encoding='utf-8') as f:
        lines = f.readlines()
    manufacturers = parse_manufacturers_models(lines)
    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(manufacturers, f, indent=2)
    create_dirs_and_files(manufacturers)
    print(f'Extracted {len(manufacturers)} manufacturers and created directories/files.')

if __name__ == '__main__':
    main()
