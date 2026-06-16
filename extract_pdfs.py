import pypdf

def extract_text(pdf_path):
    print(f"--- Extracting {pdf_path} ---")
    reader = pypdf.PdfReader(pdf_path)
    for i, page in enumerate(reader.pages):
        print(f"Page {i+1}:")
        print(page.extract_text())
        print("\n" + "="*40 + "\n")

extract_text(r"C:\Users\howdy\Downloads\Math Chess Pairings.pdf")
extract_text(r"C:\Users\howdy\Downloads\Math Chess Swiss Standings.pdf")
