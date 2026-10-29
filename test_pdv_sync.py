import importlib.util
import unittest
import sys
import types
from unittest.mock import patch
from pathlib import Path
spec=importlib.util.spec_from_file_location('sync',Path('databricks/pqr_audit_sync.py'))
sync=importlib.util.module_from_spec(spec)
with patch.dict(sys.modules,{'requests':types.ModuleType('requests')}):
    spec.loader.exec_module(sync)

class PdvSyncTests(unittest.TestCase):
    target={'target_key':'a'*32,'pdv':'00123','country':'honduras','study':'ko tradicional'}
    def test_new_lookup_is_limited_to_60_days_and_exact_tuple_with_deterministic_latest(self):
        query=sync.query_for_pdvs([self.target])
        self.assertIn('DATE_SUB(c.today,59)',query)
        self.assertIn('America/Bogota',query)
        self.assertIn('s.pdv=t.pdv AND s.country=t.country AND s.study=t.study',query)
        self.assertIn('ORDER BY s.audit_at DESC',query)
        self.assertIn('WHERE rn=1',query)
        self.assertNotIn('DATE_SUB',sync.query_for(['123']))
        for patch in [{'pdv':"1') OR TRUE --"},{'country':"honduras'"},{'target_key':'bad'},{'study':'ko'}]:
            with self.assertRaises(ValueError):sync.query_for_pdvs([{**self.target,**patch}])

    def test_missing_matches_are_explicit_and_wrong_country_is_never_published(self):
        class Result:
            def collect(self):return []
        class Spark:
            def sql(self,query):return Result()
        sent=[]
        def send(body):
            sent.append(body)
            return {'targets':[self.target],'next':None} if body['action']=='pdv_manifest' else {'ok':True}
        sync.sync_pdv_suggestions(Spark(),send,'run')
        self.assertIsNone(sent[-1]['entries'][0]['auditId'])
        class Row:
            def asDict(self):return {'key':'a'*32,'pdv':'00123','country':'guatemala','study':'ko tradicional','auditId':'123'}
        class BadResult:
            def collect(self):return [Row()]
        class BadSpark:
            def sql(self,query):return BadResult()
        sent.clear()
        with self.assertRaisesRegex(ValueError,'tuple mismatch'):sync.sync_pdv_suggestions(BadSpark(),send,'run')
        self.assertFalse(any(b['action']=='pdv_publish' for b in sent))

if __name__=='__main__':unittest.main()
