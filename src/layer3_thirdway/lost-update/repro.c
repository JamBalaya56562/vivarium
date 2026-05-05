/* Vivarium Layer 3 reproduction — canonical pthread lost-update race.
 *
 * Two threads each increment a shared counter `ITERATIONS` times with
 * no synchronisation. After both threads join, the counter should
 * equal 2*ITERATIONS, but on x86 with -O2 some increments are lost
 * to interleaving. The resulting unsynchronised read-modify-write is
 * the canonical "lost update" data race used in nearly every
 * concurrency textbook.
 *
 * Designed to be the smallest possible Layer 3 reproduction:
 *
 *   exit 0  →  counter == 2*ITERATIONS — race did NOT fire
 *              (Vivarium catalogue verdict: "unreproduced")
 *   exit 1  →  counter <  2*ITERATIONS — race fired, bug reproduces
 *              (Vivarium catalogue verdict: "reproduced")
 *
 * `replay.sh` derives the Vivarium catalogue verdict (`reproduced`
 * / `unreproduced`, per Contract v1 Revision 3 / ADR-0029) by
 * inspecting the recorded stderr rather than relying on this
 * binary's exit code alone — `rr replay --autopilot` does not
 * propagate the recorded program's exit status to its caller.
 */

#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>

/* Tunable: large enough that an unsynchronised race fires reliably
 * during `rr record --chaos` on a single core. 1e7 keeps the trace
 * small (~1 MB) while leaving plenty of interleavings for chaos
 * mode to find. */
#ifndef ITERATIONS
#define ITERATIONS 10000000L
#endif

static volatile long counter = 0;

static void *worker(void *arg) {
  (void)arg;
  for (long i = 0; i < ITERATIONS; i++) {
    counter++;
  }
  return NULL;
}

int main(void) {
  pthread_t t1, t2;
  if (pthread_create(&t1, NULL, worker, NULL) != 0) return 2;
  if (pthread_create(&t2, NULL, worker, NULL) != 0) return 2;
  pthread_join(t1, NULL);
  pthread_join(t2, NULL);

  long expected = 2L * ITERATIONS;
  fprintf(stderr, "counter = %ld, expected = %ld, lost = %ld\n",
          counter, expected, expected - counter);

  return counter == expected ? 0 : 1;
}
