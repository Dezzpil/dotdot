"""Local CLI: python -m dotdot.cli input.png out_dir [--level school ...]"""
import argparse
import json
import pathlib

from .pipeline import Options, generate


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("out")
    for k, v in vars(Options()).items():
        ap.add_argument(f"--{k}", type=type(v), default=v)
    a = ap.parse_args()
    opts = Options(**{k: getattr(a, k) for k in vars(Options())})
    res = generate(pathlib.Path(a.input).read_bytes(), opts)
    out = pathlib.Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    stem = f"{pathlib.Path(a.input).stem}-{opts.mode}-{opts.numbering}-{opts.level}-{opts.labels}-{opts.lang}"
    (out / f"{stem}.pdf").write_bytes(res.pdf)
    (out / f"{stem}-puzzle.png").write_bytes(res.preview_puzzle)
    (out / f"{stem}-answer.png").write_bytes(res.preview_answer)
    print(json.dumps(res.stats, ensure_ascii=False))


if __name__ == "__main__":
    main()
