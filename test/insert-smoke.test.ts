import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseInsertCode } from '../src/parser/insertCode';

describe('insert smoke', () => {
  it('CNMG432 is an 80 degree rhombic', () => {
    const r = parseInsertCode('CNMG432');
    assert.ok(r);
    assert.equal(r.shape.code, 'C');
    assert.equal(r.shape.includedAngle, 80);
  });
});