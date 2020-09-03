// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

// The TaskRunner prints "x.xx seconds" in TestRunner.test.ts.snap; ensure that the Stopwatch timing is deterministic
jest.mock('../../../utilities/Utilities');

import { EOL } from 'os';
import { TaskRunner, ITaskRunnerOptions } from '../TaskRunner';
import { ICollatedChunk, CollatedWriter } from '@rushstack/stream-collator';
import { TaskStatus } from '../TaskStatus';
import { ITaskDefinition, ITask } from '../ITask';
import { Utilities } from '../../../utilities/Utilities';

const mockGetTimeInMs: jest.Mock = jest.fn();
Utilities.getTimeInMs = mockGetTimeInMs;

let mockTimeInMs: number = 0;
mockGetTimeInMs.mockImplementation(() => {
  console.log('CALLED mockGetTimeInMs');
  mockTimeInMs += 100;
  return mockTimeInMs;
});

function createTaskRunner(
  taskRunnerOptions: ITaskRunnerOptions,
  taskDefinition: ITaskDefinition
): TaskRunner {
  const task: ITask = taskDefinition as ITask;
  task.dependencies = new Set<ITask>();
  task.dependents = new Set<ITask>();
  task.status = TaskStatus.Ready;

  return new TaskRunner([task], taskRunnerOptions);
}

class TestOutput {
  public chunks: ICollatedChunk[] = [];

  public writeChunk = (chunk: ICollatedChunk): void => {
    this.chunks.push(chunk);
  };
  public reset(): void {
    this.chunks.length = 0;
  }
  public getOutput(): string {
    return this.chunks.map((x) => x.text).join('');
  }

  public writeSnapshot(): void {
    expect(this.chunks).toMatchSnapshot();
  }
}
const testOutput: TestOutput = new TestOutput();

describe('TaskRunner', () => {
  let taskRunner: TaskRunner;
  let taskRunnerOptions: ITaskRunnerOptions;

  beforeEach(() => {
    testOutput.reset();
  });

  describe('Constructor', () => {
    it('throwsErrorOnInvalidParallelism', () => {
      expect(
        () =>
          new TaskRunner([], {
            quietMode: false,
            parallelism: 'tequila',
            changedProjectsOnly: false,
            writeToStreamCallback: testOutput.writeChunk,
            allowWarningsInSuccessfulBuild: false
          })
      ).toThrowErrorMatchingSnapshot();
    });
  });

  describe('Error logging', () => {
    beforeEach(() => {
      taskRunnerOptions = {
        quietMode: false,
        parallelism: '1',
        changedProjectsOnly: false,
        writeToStreamCallback: testOutput.writeChunk,
        allowWarningsInSuccessfulBuild: false
      };
    });

    const EXPECTED_FAIL: string = 'Promise returned by execute() resolved but was expected to fail';

    it('printedStderrAfterError', () => {
      taskRunner = createTaskRunner(taskRunnerOptions, {
        name: 'stdout+stderr',
        isIncrementalBuildAllowed: false,
        execute: (writer: CollatedWriter) => {
          writer.terminal.writeStdoutLine('Build step 1');
          writer.terminal.writeStderrLine('Error: step 1 failed');
          return Promise.resolve(TaskStatus.Failure);
        },
        hadEmptyScript: false
      });

      return taskRunner
        .execute()
        .then(() => fail(EXPECTED_FAIL))
        .catch((err) => {
          expect(err.message).toMatchSnapshot();
          const allMessages: string = testOutput.getOutput();
          expect(allMessages).not.toContain('Build step 1');
          expect(allMessages).toContain('Error: step 1 failed');
          testOutput.writeSnapshot();
        });
    });

    it('printedStdoutAfterErrorWithEmptyStderr', () => {
      taskRunner = createTaskRunner(taskRunnerOptions, {
        name: 'stdout only',
        isIncrementalBuildAllowed: false,
        execute: (writer: CollatedWriter) => {
          writer.terminal.writeStdoutLine('Build step 1' + EOL);
          writer.terminal.writeStdoutLine('Error: step 1 failed' + EOL);
          return Promise.resolve(TaskStatus.Failure);
        },
        hadEmptyScript: false
      });

      return taskRunner
        .execute()
        .then(() => fail(EXPECTED_FAIL))
        .catch((err) => {
          expect(err.message).toMatchSnapshot();
          expect(testOutput.getOutput()).toMatch(/Build step 1.*Error: step 1 failed/);
          testOutput.writeSnapshot();
        });
    });

    it('printedAbridgedStdoutAfterErrorWithEmptyStderr', () => {
      taskRunner = createTaskRunner(taskRunnerOptions, {
        name: 'large stdout only',
        isIncrementalBuildAllowed: false,
        execute: (writer: CollatedWriter) => {
          writer.terminal.writeStdoutLine(`Building units...${EOL}`);
          for (let i: number = 1; i <= 50; i++) {
            writer.terminal.writeStdoutLine(` - unit #${i};${EOL}`);
          }
          return Promise.resolve(TaskStatus.Failure);
        },
        hadEmptyScript: false
      });

      return taskRunner
        .execute()
        .then(() => fail(EXPECTED_FAIL))
        .catch((err) => {
          expect(err.message).toMatchSnapshot();
          expect(testOutput.getOutput()).toMatch(
            /Building units.* - unit #1;.* - unit #3;.*lines omitted.* - unit #48;.* - unit #50;/
          );
          testOutput.writeSnapshot();
        });
    });

    it('preservedLeadingBlanksButTrimmedTrailingBlanks', () => {
      taskRunner = createTaskRunner(taskRunnerOptions, {
        name: 'large stderr with leading and trailing blanks',
        isIncrementalBuildAllowed: false,
        execute: (writer: CollatedWriter) => {
          writer.terminal.writeStderrLine(`List of errors:  ${EOL}`);
          for (let i: number = 1; i <= 50; i++) {
            writer.terminal.writeStderrLine(` - error #${i};  ${EOL}`);
          }
          return Promise.resolve(TaskStatus.Failure);
        },
        hadEmptyScript: false
      });

      return taskRunner
        .execute()
        .then(() => fail(EXPECTED_FAIL))
        .catch((err) => {
          expect(err.message).toMatchSnapshot();
          expect(testOutput.getOutput()).toMatch(
            /List of errors:\S.* - error #1;\S.*lines omitted.* - error #48;\S.* - error #50;\S/
          );
          testOutput.writeSnapshot();
        });
    });
  });

  describe('Warning logging', () => {
    describe('Fail on warning', () => {
      beforeEach(() => {
        taskRunnerOptions = {
          quietMode: false,
          parallelism: '1',
          changedProjectsOnly: false,
          writeToStreamCallback: testOutput.writeChunk,
          allowWarningsInSuccessfulBuild: false
        };
      });

      it('Logs warnings correctly', () => {
        taskRunner = createTaskRunner(taskRunnerOptions, {
          name: 'success with warnings (failure)',
          isIncrementalBuildAllowed: false,
          execute: (writer: CollatedWriter) => {
            writer.terminal.writeStdoutLine('Build step 1' + EOL);
            writer.terminal.writeStdoutLine('Warning: step 1 succeeded with warnings' + EOL);
            return Promise.resolve(TaskStatus.SuccessWithWarning);
          },
          hadEmptyScript: false
        });

        return taskRunner
          .execute()
          .then(() => fail('Promise returned by execute() resolved but was expected to fail'))
          .catch((err) => {
            expect(err.message).toMatchSnapshot();
            const allMessages: string = testOutput.getOutput();
            expect(allMessages).toContain('Build step 1');
            expect(allMessages).toContain('step 1 succeeded with warnings');
            testOutput.writeSnapshot();
          });
      });
    });

    describe('Success on warning', () => {
      beforeEach(() => {
        taskRunnerOptions = {
          quietMode: false,
          parallelism: '1',
          changedProjectsOnly: false,
          writeToStreamCallback: testOutput.writeChunk,
          allowWarningsInSuccessfulBuild: true
        };
      });

      it('Logs warnings correctly', () => {
        taskRunner = createTaskRunner(taskRunnerOptions, {
          name: 'success with warnings (success)',
          isIncrementalBuildAllowed: false,
          execute: (writer: CollatedWriter) => {
            writer.terminal.writeStdoutLine('Build step 1' + EOL);
            writer.terminal.writeStdoutLine('Warning: step 1 succeeded with warnings' + EOL);
            return Promise.resolve(TaskStatus.SuccessWithWarning);
          },
          hadEmptyScript: false
        });

        return taskRunner
          .execute()
          .then(() => {
            const allMessages: string = testOutput.getOutput();
            expect(allMessages).toContain('Build step 1');
            expect(allMessages).toContain('Warning: step 1 succeeded with warnings');
            testOutput.writeSnapshot();
          })
          .catch((err) => fail('Promise returned by execute() rejected but was expected to resolve'));
      });
    });
  });
});
