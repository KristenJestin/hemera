// Says the greeting it finds in its environment, then ends: what an agents' test asks of it.
process.stdout.write(`${process.env.HEMERA_TEST_GREETING ?? 'no greeting'}\n`)
