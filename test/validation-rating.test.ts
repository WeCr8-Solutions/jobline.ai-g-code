import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { recordRatingChoice, recordSuccessfulValidation } from '../src/validationRating';

describe('Marketplace rating timing', () => {
  it('prompts at 10, defers 25 after Later, and stops after Never', () => {
    let state;
    let prompt = false;
    for (let i = 0; i < 10; i++) ({ state, prompt } = recordSuccessfulValidation(state));
    assert.equal(prompt, true);
    state = recordRatingChoice(state!, 'Later');
    for (let i = 0; i < 24; i++) {
      ({ state, prompt } = recordSuccessfulValidation(state));
      assert.equal(prompt, false);
    }
    ({ state, prompt } = recordSuccessfulValidation(state));
    assert.equal(prompt, true);
    state = recordRatingChoice(state!, 'Never');
    ({ state, prompt } = recordSuccessfulValidation(state));
    assert.equal(prompt, false);
  });

  it('stops after Rate and treats dismissal as Later', () => {
    const tenth = { successfulRuns: 10, nextPromptAt: 10 };
    assert.equal(recordRatingChoice(tenth, undefined).nextPromptAt, 35);
    assert.equal(recordSuccessfulValidation(recordRatingChoice(tenth, 'Rate')).prompt, false);
  });
});
