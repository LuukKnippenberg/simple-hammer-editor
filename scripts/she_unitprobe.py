# Test probe for sp_unit_kits_test (simple-hammer-editor unit kits): every unit's height above the ground.
from vmath import Vector
from srcbase import MASK_SOLID_BRUSHONLY
from entities import entlist
from utils import trace_t, UTIL_TraceLine

def _get(f):
    try:
        return f()
    except Exception as ex:
        return '?%s' % type(ex).__name__

for cls in ['unit_stalker', 'unit_citizen', 'unit_strider', 'unit_combinedropship', 'unit_combinegunship',
            'unit_metropolice', 'unit_cscanner', 'unit_manhack']:
    e = entlist.FindEntityByClassname(None, cls)
    while e:
        o = e.GetAbsOrigin()
        tr = trace_t()
        UTIL_TraceLine(o, o - Vector(0, 0, 8192), MASK_SOLID_BRUSHONLY, None, 0, tr)
        print('SHE_UNIT %s type=%s owner=%s pos=%d,%d z=%d above_ground=%d health=%s' % (
            cls, _get(lambda: e.unitinfo.name), _get(lambda: e.GetOwnerNumber()), int(o.x), int(o.y), int(o.z),
            int(o.z - tr.endpos.z), _get(lambda: e.health)))
        e = entlist.FindEntityByClassname(e, cls)
