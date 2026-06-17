{
  description = "Sa-Yu (document-writer) — Python 로컬 API + Node (Vite)";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.11";

  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
    in
    {
      devShells.${system}.default = pkgs.mkShell {
        buildInputs = with pkgs; [
          python312
          python312Packages.uv
          nodejs_22
          nix
        ];
        shellHook = ''
          echo "로컬 API: cd services/document-writer && python3 -m venv .venv && .venv/bin/pip install -r requirements-local-api.txt && ./run-local-api.sh"
          echo "프론트: cd services/document-writer/frontend && npm run dev"
        '';
      };
    };
}
