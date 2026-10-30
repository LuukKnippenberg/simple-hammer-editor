"""Builds src/lw/unitCatalog.json, the unit list of the mission kits, from the game itself.

Sources (both from the game install, `lambdawars/`):
- lambdawars.fgd: every `unit_*` entity class with its studio() model and the `unittype` choices it accepts.
- python/wars_game/**.py (read with `ast`, nothing is imported): the UnitInfo classes (name, cls_name,
  modelname, displayname, image_name, hulltype, zoffset, scale, inherited through their bases) and the unit entity
  classes (@entity('unit_x')) for air units: LocomotionClass = UnitBaseAirLocomotion and the
  `locomotion.desiredheight` (or helicopter `flyheight`) they keep above the ground.
- resource/lambdawars_english.txt: the display names (#CombStalker_Name -> Stalker).

Run from the editor folder: python scripts/gen-unit-catalog.py [path/to/lambdawars-game]
(default: the `install` in editor.config.json).
"""
import ast
import json
import os
import re
import sys
import warnings

warnings.simplefilter('ignore', SyntaxWarning)  # old game files have '\G' style escapes in strings

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'src', 'lw', 'unitCatalog.ts')


def install_dir():
    if len(sys.argv) > 1:
        return sys.argv[1]
    with open(os.path.join(ROOT, 'editor.config.json'), encoding='utf-8') as f:
        return json.load(f)['install']


GAME = os.path.join(install_dir(), 'lambdawars')

# ---------------------------------------------------------------- FGD

def read_fgd():
    """{class: {'studio': str|None, 'unittypes': [..], 'default': str}} for every unit_* NPC class."""
    text = open(os.path.join(GAME, 'lambdawars.fgd'), encoding='utf-8', errors='replace').read()
    out = {}
    for m in re.finditer(r'^@NPCClass([^\n=]*)=\s*(unit_\w+)\s*:', text, re.M):
        cls = m.group(2).lower()
        studio = re.search(r'studio\("([^"]*)"\)', m.group(1))
        body = text[m.end():text.find('\n@', m.end())]
        ut = re.search(r'unittype\(choices\)\s*:\s*"[^"]*"\s*:\s*"([^"]*)"[^=]*=\s*\[(.*?)\]', body, re.S)
        out[cls] = {
            'studio': studio.group(1).lower().replace('\\', '/') if studio else None,
            'unittypes': re.findall(r'^\s*"([^"]+)"\s*:', ut.group(2), re.M) if ut else [],
            'default': ut.group(1) if ut else '',
        }
    return out

# ---------------------------------------------------------------- localisation

def read_strings():
    path = os.path.join(GAME, 'resource', 'lambdawars_english.txt')
    raw = open(path, 'rb').read()
    text = raw.decode('utf-16') if raw[:2] in (b'\xff\xfe', b'\xfe\xff') else raw.decode('utf-8', 'replace')
    return {k.lower(): v for k, v in re.findall(r'^\s*"([^"]+)"\s+"([^"]*)"', text, re.M)}

# ---------------------------------------------------------------- Python

INFO_KEYS = ('name', 'cls_name', 'modelname', 'displayname', 'image_name', 'zoffset', 'scale', 'hulltype')


class PyClass:
    def __init__(self, module, node, bases):
        self.module = module
        self.name = node.name
        self.bases = bases  # PyClass or str (unresolved name)
        self.attrs = {}
        self.entity = None
        for dec in node.decorator_list:
            if isinstance(dec, ast.Call) and getattr(dec.func, 'id', '') == 'entity' and dec.args and isinstance(dec.args[0], ast.Constant):
                self.entity = str(dec.args[0].value).lower()
        for stmt in node.body:
            if isinstance(stmt, ast.Assign) and len(stmt.targets) == 1 and isinstance(stmt.targets[0], ast.Name):
                key = stmt.targets[0].id
                val = constant(stmt.value)
                if key in INFO_KEYS + ('flyheight',) and val is not None:
                    self.attrs[key] = val
                elif key == 'LocomotionClass' and isinstance(stmt.value, ast.Name):
                    self.attrs['locomotion'] = stmt.value.id
        # self.locomotion.desiredheight = 370.0 anywhere in the class's methods (the first one wins).
        for sub in ast.walk(node):
            if isinstance(sub, ast.Assign) and len(sub.targets) == 1:
                t = sub.targets[0]
                if isinstance(t, ast.Attribute) and t.attr == 'desiredheight' and isinstance(t.value, ast.Attribute) and t.value.attr == 'locomotion':
                    val = constant(sub.value)
                    if isinstance(val, (int, float)) and val > 0:
                        self.attrs.setdefault('desiredheight', val)
                        break

    def mro(self, classes):
        seen, out, todo = set(), [], [self]
        while todo:
            c = todo.pop(0)
            if isinstance(c, str):
                c = classes.get(c)
            if c is None or id(c) in seen:
                continue
            seen.add(id(c))
            out.append(c)
            todo.extend(c.bases)
        return out

    def get(self, key, classes):
        for c in self.mro(classes):
            if key in c.attrs:
                return c.attrs[key]
        return None

    def derives(self, base, classes):
        return any(c.name == base or base in [b for b in c.bases if isinstance(b, str)] for c in self.mro(classes))


def constant(node):
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub) and isinstance(node.operand, ast.Constant):
        return -node.operand.value
    # StringField(value='...') / FloatField(value=1)
    if isinstance(node, ast.Call):
        for kw in node.keywords:
            if kw.arg == 'value':
                return constant(kw.value)
    return None


def read_python():
    """All classes in wars_game, bases resolved in definition order (a class may shadow its own base)."""
    classes, by_name = [], {}
    base_dir = os.path.join(GAME, 'python', 'wars_game')
    for dirpath, dirs, files in os.walk(base_dir):
        dirs[:] = [d for d in dirs if d != '__pycache__']
        for f in sorted(files):
            if not f.endswith('.py'):
                continue
            path = os.path.join(dirpath, f)
            try:
                tree = ast.parse(open(path, encoding='utf-8', errors='replace').read())
            except SyntaxError:
                continue
            module = os.path.relpath(path, base_dir).replace('\\', '/')
            names = {}  # module namespace: aliases from imports, then classes as they are defined
            for stmt in tree.body:
                if isinstance(stmt, ast.ImportFrom):
                    for a in stmt.names:
                        names[a.asname or a.name] = a.name
                elif isinstance(stmt, ast.ClassDef):
                    bases = []
                    for b in stmt.bases:
                        n = b.id if isinstance(b, ast.Name) else b.attr if isinstance(b, ast.Attribute) else None
                        if n:
                            bases.append(names.get(n, n))
                    c = PyClass(module, stmt, bases)
                    names[stmt.name] = c
                    classes.append(c)
                    by_name.setdefault(stmt.name, c)
    return classes, by_name

# ---------------------------------------------------------------- catalog

FACTION_BY_IMAGE = (('vgui/combine/', 'combine'), ('vgui/rebels/', 'rebels'), ('vgui/antlions/', 'antlions'))
# Units without a faction image: grouped by the module that defines them.
FACTION_BY_MODULE = {
    'zombie': 'zombies', 'basezombie': 'zombies', 'fastzombie': 'zombies', 'poisonzombie': 'zombies',
    'zombine': 'zombies', 'headcrab': 'zombies', 'antlion': 'antlions', 'antlionguard': 'antlions',
    'antliongrub': 'antlions', 'mutalisk': 'antlions', 'citizen': 'citizens', 'barney': 'rebels',
    'alyx': 'rebels', 'dog': 'rebels', 'vortigaunt': 'rebels', 'jeep': 'rebels', 'combine': 'combine',
    'metropolice': 'combine', 'scanner': 'combine', 'manhack': 'combine', 'stalker': 'combine',
    'strider': 'combine', 'hunter': 'combine', 'combinedropship': 'combine', 'combinegunship': 'combine',
    'rollermine': 'combine', 'crab_synth': 'combine', 'mortar_synth': 'combine', 'combine_mine': 'combine',
    'headcrabcanister': 'combine',
}
# Prefixes of game-mode copies (overrun waves, destroy-HQ, characters): listed, but after the plain units.
VARIANT_PREFIXES = ('overrun_', 'destroyhq_', 'char_', 'mission_', 'sp_', 'swarmkeeper_')


# Entity classes that are helpers, not units to place (building dummies, damage controllers, scans).
NOT_PLACEABLE = re.compile(r'^unit_(dummy|damage_controller.*|scan|teleporter_rift)$')


def faction_of(image, module):
    image = (image or '').lower()
    stem = os.path.splitext(os.path.basename(module))[0] if module else ''
    if stem == 'citizen' and not image.startswith('vgui/combine/'):
        return 'citizens'  # refugees use the rebels' icons, but are their own group in a mission
    for prefix, f in FACTION_BY_IMAGE:
        if image.startswith(prefix):
            return f
    if stem in FACTION_BY_MODULE:
        return FACTION_BY_MODULE[stem]
    if module and module.startswith('singleplayer/'):
        return 'mission'
    return 'other'


def nice_label(display, strings, unittype):
    """Localised name; else the displayname key or the unittype made readable (#CombGunship_Name -> Gunship)."""
    if display.startswith('#'):
        if display[1:].lower() in strings:
            return strings[display[1:].lower()]
        key = re.sub(r'_Name$', '', display[1:])
        key = re.sub(r'^(Comb|Reb)(?=[A-Z])', '', key)
        return re.sub(r'(?<=[a-z])(?=[A-Z])', ' ', key)
    if display:
        return display
    return re.sub(r'^unit ', '', unittype.replace('_', ' ')).capitalize()


FACTION_ORDER = ('combine', 'rebels', 'citizens', 'zombies', 'antlions', 'mission', 'other')

HEADER = """// Generated by scripts/gen-unit-catalog.py from lambdawars.fgd and python/wars_game. Do not edit by hand.

export interface CatalogUnit {
  /** The `unittype` key (UnitInfo.name). */
  unittype: string;
  /** Entity class to place (UnitInfo.cls_name). */
  cls: string;
  label: string;
  faction: %s;
  /** UnitInfo.modelname, else the FGD studio() model. */
  model: string | null;
  /** Python file (or lambdawars.fgd) the type comes from. */
  source: string;
  hull?: string;
  /** Height above the ground that the air locomotion keeps (locomotion.desiredheight). */
  air?: number;
  /** UnitInfo.zoffset: added by unit_maker and build placement after dropping the unit to the floor. */
  zoffset?: number;
  scale?: number;
  /** A game-mode copy (overrun_, char_, mission_, ...). */
  variant?: boolean;
}

export const UNIT_CATALOG: CatalogUnit[] = [
""" % ' | '.join(f"'{f}'" for f in FACTION_ORDER)


def main():
    fgd = read_fgd()
    strings = read_strings()
    classes, by_name = read_python()
    lookup = {c.name: c for c in reversed(classes)}  # first definition per name for unresolved bases
    lookup.update(by_name)

    # Air entity classes and the height their locomotion keeps above the ground.
    air = {}
    for c in classes:
        if c.entity and c.get('locomotion', lookup) == 'UnitBaseAirLocomotion':
            h = c.get('desiredheight', lookup)
            fly = c.get('flyheight', lookup)
            # BaseHelicopter sets desiredheight = self.flyheight (not a constant), so use flyheight there.
            air[c.entity] = float(h if isinstance(h, (int, float)) else fly if isinstance(fly, (int, float)) else 450.0)
    units = {}
    for c in classes:
        if 'name' not in c.attrs or not c.derives('UnitInfo', lookup) or c.name == 'UnitInfo':
            continue
        name = str(c.attrs['name'])
        cls = str(c.get('cls_name', lookup) or '').lower()
        if not cls.startswith('unit_') or cls not in fgd or NOT_PLACEABLE.match(cls):
            continue
        model = str(c.get('modelname', lookup) or '').lower().replace('\\', '/') or None
        zoffset = c.get('zoffset', lookup)
        scale = c.get('scale', lookup)
        entry = {
            'unittype': name,
            'cls': cls,
            'label': nice_label(str(c.get('displayname', lookup) or ''), strings, name),
            'faction': faction_of(c.get('image_name', lookup), c.module),
            'model': model or fgd[cls]['studio'],
            'source': f'wars_game/{c.module}',
        }
        hull = c.get('hulltype', lookup)
        if isinstance(hull, str):
            entry['hull'] = hull
        if isinstance(zoffset, (int, float)) and zoffset:
            entry['zoffset'] = float(zoffset)
        if isinstance(scale, (int, float)) and scale != 1:
            entry['scale'] = float(scale)
        if cls in air:
            entry['air'] = air[cls]
        if name.startswith(VARIANT_PREFIXES):
            entry['variant'] = True
        units.setdefault(name, entry)  # the first definition of a name wins

    # FGD classes and unittype choices that the Python scan did not see (still placeable).
    for cls, f in fgd.items():
        if NOT_PLACEABLE.match(cls):
            continue
        for ut in f['unittypes'] or [cls]:
            if ut in units or ut == 'unit_unknown':
                continue
            units[ut] = {
                'unittype': ut, 'cls': cls, 'label': nice_label('', strings, ut), 'faction': 'other',
                'model': f['studio'], 'source': 'lambdawars.fgd',
                **({'air': air[cls]} if cls in air else {}),
                **({'variant': True} if ut.startswith(VARIANT_PREFIXES) else {}),
            }

    order = list(FACTION_ORDER)
    out = sorted(units.values(), key=lambda u: (order.index(u['faction']), bool(u.get('variant')), u['label'].lower()))
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write(HEADER)
        for u in out:
            f.write('  ' + json.dumps(u, separators=(', ', ': ')) + ',\n')
        f.write('];\n')
    print(f'{len(out)} unit types, {sum(1 for u in out if "air" in u)} air -> {os.path.relpath(OUT, ROOT)}')


main()
