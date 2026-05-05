<?php
// Vivarium Layer 1 reproduction — php/php-src#12167, native variant.
//
// Mirrors the script that runs in `repro.ts` (under php-wasm) so a
// contributor can re-verify the bug against a real PHP interpreter:
//
//   mise install               # one-time, picks up .mise.toml
//   mise exec php -- php src/layer1_wasm/php-12167/repro.php
//
// The script prints `pass` if the bug REPRODUCES (xpath returns the
// processing-instruction node but casting it to string yields ""),
// `fail` otherwise — same verdict semantics as the in-browser page.
// Exit code: 0 on `pass`, 1 on `fail` so CI can shell-script around
// it without parsing stdout.

$xml = '<?xml version="1.0"?><foo><bar><?stylesheet hello ?></bar></foo>';
$sxe = simplexml_load_string($xml);
$pis = $sxe->xpath("//processing-instruction()");
$pi_text = isset($pis[0]) ? (string) $pis[0] : null;

$result = [
    "php_version"   => PHP_VERSION,
    "xpath_count"   => count($pis ?: []),
    "pi_text"       => $pi_text,
    "pi_text_empty" => $pi_text === "",
];

$reproduced = $result["xpath_count"] === 1 && $result["pi_text_empty"];

echo json_encode($result, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT) . "\n";

if ($reproduced) {
    fwrite(STDOUT, "verdict=reproduced — bug reproduces on this interpreter\n");
    exit(0);
} elseif ($result["xpath_count"] === 1 && !$result["pi_text_empty"]) {
    fwrite(STDOUT, "verdict=unreproduced — SimpleXML now returns the PI content (likely fixed upstream)\n");
    exit(1);
} else {
    fwrite(
        STDOUT,
        "verdict=unreproduced — unexpected outcome (xpath_count={$result['xpath_count']}, pi_text=" . json_encode($result["pi_text"]) . ")\n",
    );
    exit(1);
}
